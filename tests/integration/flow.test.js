import request from 'supertest';

// Set up environment overrides before importing modules
process.env.NODE_ENV = 'test';
process.env.PORT = '8081';
process.env.MAX_RETRIES = '2';
process.env.RETRY_INITIAL_DELAY = '100'; // 100ms
process.env.RETRY_BACKOFF_FACTOR = '2';  // exponential factor
process.env.MQ_QUEUE_NAME = 'notification_events_test';
process.env.MQ_EXCHANGE_NAME = 'notification_exchange_test';
process.env.MQ_ROUTING_KEY = 'notification_key_test';
process.env.MQ_DLQ_NAME = 'notification_dead_letter_queue_test';

// Dynamically import modules to capture overrides
const { app } = await import('../../src/api/server.js');
const { getDbPool, closeDb } = await import('../../src/services/db.js');
const { getMqChannel, closeMq, initializeMq } = await import('../../src/services/mq.js');
const { startConsumer } = await import('../../src/consumer/index.js');
const { config } = await import('../../src/config/index.js');

describe('Event-Driven Notification Service Integration Tests', () => {
  let server;
  let dbPool;
  let mqChannel;

  beforeAll(async () => {
    // 1. Start Server on custom test port
    server = app.listen(config.port);

    // 2. Setup database pool
    dbPool = getDbPool();

    // 3. Clear existing queues to prevent PRECONDITION-FAILED errors (TTL mismatches)
    mqChannel = await getMqChannel();
    await mqChannel.deleteQueue(config.mq.queueName);
    await mqChannel.deleteQueue(config.mq.dlqName);
    for (let i = 1; i <= 5; i++) {
      await mqChannel.deleteQueue(`${config.mq.queueName}_retry_${i}`);
    }

    // 4. Initialize MQ
    await initializeMq();
  });

  afterAll(async () => {
    // Graceful closures
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await closeMq();
    await closeDb();
  });

  beforeEach(async () => {
    // Purge DB tables
    await dbPool.query('DELETE FROM notification_logs');
    await dbPool.query('DELETE FROM processed_events');

    // Purge RabbitMQ queues to prevent test bleed
    await mqChannel.purgeQueue(config.mq.queueName);
    await mqChannel.purgeQueue(config.mq.dlqName);
    for (let i = 1; i <= config.retry.maxRetries; i++) {
      await mqChannel.purgeQueue(`${config.mq.queueName}_retry_${i}`);
    }
  });

  // Helper to wait for database status updates asynchronously
  async function waitForStatus(eventId, expectedStatus, timeout = 3000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const [rows] = await dbPool.query(
        'SELECT status FROM processed_events WHERE event_id = ?',
        [eventId]
      );
      if (rows.length > 0 && rows[0].status === expectedStatus) {
        return rows[0].status;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Timeout waiting for event ${eventId} to transition to ${expectedStatus}`);
  }

  test('Successful flow: should publish, consume, insert status and audit log', async () => {
    // Start the consumer loop
    await startConsumer();

    const eventId = '9128f731-893c-4a3b-851f-2e38c92a1050';
    const event = {
      event_id: eventId,
      type: 'email',
      recipient: 'user@example.com',
      payload: { subject: 'Integration Test', body: 'Success flow test' },
      timestamp: new Date().toISOString()
    };

    // 1. Publish event via API
    const response = await request(app)
      .post('/api/v1/publish-notification-event')
      .send(event);

    expect(response.status).toBe(202);
    expect(response.body.event_id).toBe(eventId);

    // 2. Wait for consumer to process
    await waitForStatus(eventId, 'COMPLETED');

    // 3. Assert database state
    const [events] = await dbPool.query('SELECT * FROM processed_events WHERE event_id = ?', [eventId]);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('COMPLETED');

    const [logs] = await dbPool.query('SELECT * FROM notification_logs WHERE event_id = ?', [eventId]);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('SENT');
    expect(logs[0].recipient).toBe('user@example.com');
  });

  test('Idempotency flow: should ignore duplicate events', async () => {
    // Start the consumer loop
    await startConsumer();

    const eventId = '2a39a7b9-de58-452d-94bb-4cf467dbbde0';
    const event = {
      event_id: eventId,
      type: 'sms',
      recipient: '+123456789',
      payload: { body: 'Verification code: 1234' },
      timestamp: new Date().toISOString()
    };

    // Send original
    await request(app).post('/api/v1/publish-notification-event').send(event);
    await waitForStatus(eventId, 'COMPLETED');

    // Send duplicate
    const dupResponse = await request(app).post('/api/v1/publish-notification-event').send(event);
    expect(dupResponse.status).toBe(202);

    // Wait slightly to verify no additional audit logs are created
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify database counts
    const [events] = await dbPool.query('SELECT * FROM processed_events WHERE event_id = ?', [eventId]);
    expect(events).toHaveLength(1);

    const [logs] = await dbPool.query('SELECT * FROM notification_logs WHERE event_id = ?', [eventId]);
    expect(logs).toHaveLength(1); // Only 1 log should exist
  });

  test('Transient failure retry and DLQ routing flow', async () => {
    // Start the consumer loop
    await startConsumer();

    const eventId = 'e210b3c6-91b3-462c-8822-4933994ee312';
    const event = {
      event_id: eventId,
      type: 'push',
      recipient: 'device-token-123',
      payload: {
        title: 'Transient Failure',
        body: 'This will retry and move to DLQ',
        simulate_transient_failure: true
      },
      timestamp: new Date().toISOString()
    };

    // Publish event
    await request(app).post('/api/v1/publish-notification-event').send(event);

    // Wait for the event to exhaust all retries and transition to FAILED
    await waitForStatus(eventId, 'FAILED', 5000);

    // Verify DB state
    const [events] = await dbPool.query('SELECT * FROM processed_events WHERE event_id = ?', [eventId]);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('FAILED');

    const [logs] = await dbPool.query('SELECT * FROM notification_logs WHERE event_id = ?', [eventId]);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('DLQ_MOVED');

    // Verify message has arrived in the RabbitMQ DLQ
    const dlqMsg = await mqChannel.get(config.mq.dlqName, { noAck: false });
    expect(dlqMsg).not.toBeFalsy();
    
    const dlqPayload = JSON.parse(dlqMsg.content.toString());
    expect(dlqPayload.event_id).toBe(eventId);
    expect(dlqMsg.properties.headers['x-retry-count']).toBe(2); // MAX_RETRIES override is 2
    expect(dlqMsg.properties.headers['x-original-error']).toContain('External notification provider timed out');

    mqChannel.ack(dlqMsg);
  });

  test('Permanent failure: should skip retries and route directly to DLQ', async () => {
    // Start the consumer loop
    await startConsumer();

    const eventId = 'c139b4b9-8cc2-4df4-b3bb-192cc8ab219d';
    const event = {
      event_id: eventId,
      type: 'email',
      recipient: 'bad-email-address',
      payload: {
        subject: 'Permanent Failure',
        body: 'Go straight to DLQ',
        simulate_permanent_failure: true
      },
      timestamp: new Date().toISOString()
    };

    // Publish event
    await request(app).post('/api/v1/publish-notification-event').send(event);

    // Wait for immediate FAILED status in DB
    await waitForStatus(eventId, 'FAILED');

    // Verify DB state
    const [events] = await dbPool.query('SELECT * FROM processed_events WHERE event_id = ?', [eventId]);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('FAILED');

    const [logs] = await dbPool.query('SELECT * FROM notification_logs WHERE event_id = ?', [eventId]);
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('DLQ_MOVED');

    // Verify message is in DLQ with 0 retries
    const dlqMsg = await mqChannel.get(config.mq.dlqName, { noAck: false });
    expect(dlqMsg).not.toBeFalsy();

    const dlqPayload = JSON.parse(dlqMsg.content.toString());
    expect(dlqPayload.event_id).toBe(eventId);
    expect(dlqMsg.properties.headers['x-retry-count']).toBe(0); // directly DLQ'd
    expect(dlqMsg.properties.headers['x-original-error']).toContain('Recipient address is blacklisted or invalid');

    mqChannel.ack(dlqMsg);
  });
});
