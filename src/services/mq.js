import amqp from 'amqplib';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { getRetryDelay } from '../utils/retryHelper.js';

let connection = null;
let channel = null;

export async function getMqConnection() {
  if (!connection) {
    const url = `amqp://${config.mq.user}:${config.mq.password}@${config.mq.host}:${config.mq.port}`;
    connection = await amqp.connect(url);
    logger.info('Connected to RabbitMQ', { host: config.mq.host, port: config.mq.port });
  }
  return connection;
}

export async function getMqChannel() {
  if (!channel) {
    const conn = await getMqConnection();
    channel = await conn.createChannel();
    logger.info('RabbitMQ channel created');
  }
  return channel;
}

/**
 * Initializes RabbitMQ exchanges, queues, and bindings.
 */
export async function initializeMq() {
  const ch = await getMqChannel();
  
  // 1. Declare Exchange
  await ch.assertExchange(config.mq.exchangeName, 'direct', { durable: true });
  
  // 2. Declare DLQ
  await ch.assertQueue(config.mq.dlqName, { durable: true });
  await ch.bindQueue(config.mq.dlqName, config.mq.exchangeName, config.mq.dlqName);
  
  // 3. Declare Main Queue
  await ch.assertQueue(config.mq.queueName, { durable: true });
  await ch.bindQueue(config.mq.queueName, config.mq.exchangeName, config.mq.routingKey);
  
  // 4. Declare Retry Queues with Exponential Backoff TTLs
  const { maxRetries, initialDelay, backoffFactor } = config.retry;
  for (let i = 1; i <= maxRetries; i++) {
    const delay = getRetryDelay(i, initialDelay, backoffFactor);
    const retryQueueName = `${config.mq.queueName}_retry_${i}`;
    
    await ch.assertQueue(retryQueueName, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': config.mq.exchangeName,
        'x-dead-letter-routing-key': config.mq.routingKey,
        'x-message-ttl': delay
      }
    });
    
    // Bind retry queue to routing key matching its own name
    await ch.bindQueue(retryQueueName, config.mq.exchangeName, retryQueueName);
    logger.info(`RabbitMQ declared retry queue`, { queue: retryQueueName, ttlMs: delay });
  }
}

/**
 * Publishes a notification event to the main queue.
 */
export async function publishToMainQueue(event) {
  const ch = await getMqChannel();
  const payloadStr = JSON.stringify(event);
  const ok = ch.publish(
    config.mq.exchangeName,
    config.mq.routingKey,
    Buffer.from(payloadStr),
    { persistent: true }
  );
  if (ok) {
    logger.debug('Event published to main queue', { event_id: event.event_id });
  } else {
    throw new Error('Failed to publish to main queue (buffer full)');
  }
}

/**
 * Routes message to the appropriate retry queue based on retry attempt.
 */
export async function publishToRetryQueue(event, retryCount) {
  const ch = await getMqChannel();
  const retryQueueName = `${config.mq.queueName}_retry_${retryCount}`;
  const payloadStr = JSON.stringify(event);
  
  logger.info('Routing event to retry queue', {
    event_id: event.event_id,
    retryCount,
    queue: retryQueueName
  });
  
  const ok = ch.publish(
    config.mq.exchangeName,
    retryQueueName,
    Buffer.from(payloadStr),
    {
      persistent: true,
      headers: {
        'x-retry-count': retryCount
      }
    }
  );
  if (!ok) {
    throw new Error(`Failed to publish to retry queue: ${retryQueueName}`);
  }
}

/**
 * Routes message directly to the Dead-Letter Queue (DLQ).
 */
export async function publishToDlq(event, retryCount, errorMsg) {
  const ch = await getMqChannel();
  const payloadStr = JSON.stringify(event);
  
  logger.warn('Routing event to dead-letter queue (DLQ)', {
    event_id: event.event_id,
    retryCount,
    reason: errorMsg
  });
  
  const ok = ch.publish(
    config.mq.exchangeName,
    config.mq.dlqName,
    Buffer.from(payloadStr),
    {
      persistent: true,
      headers: {
        'x-retry-count': retryCount,
        'x-original-error': errorMsg
      }
    }
  );
  if (!ok) {
    throw new Error('Failed to publish to dead-letter queue');
  }
}

/**
 * Closes channel and connection.
 */
export async function closeMq() {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
  logger.info('RabbitMQ connection closed');
}
