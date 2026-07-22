import express from 'express';
import { validateNotificationEvent } from '../utils/validation.js';
import { publishToMainQueue } from '../services/mq.js';
import { getDbPool } from '../services/db.js';
import { getMqConnection } from '../services/mq.js';
import logger from '../utils/logger.js';

const app = express();
app.use(express.json());

// Publisher endpoint
app.post('/api/v1/publish-notification-event', async (req, res) => {
  const validationError = validateNotificationEvent(req.body);
  if (validationError) {
    logger.warn('Publish validation failed', { error: validationError, payload: req.body });
    return res.status(400).json({ error: validationError });
  }

  try {
    await publishToMainQueue(req.body);
    logger.info('Accepted and published event to queue', { event_id: req.body.event_id });
    return res.status(202).json({ status: 'Accepted', event_id: req.body.event_id });
  } catch (error) {
    logger.error('Failed to publish event to queue', { event_id: req.body.event_id, error: error.message });
    return res.status(500).json({ error: 'Failed to publish event to message queue' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // 1. Verify DB
    const pool = getDbPool();
    await pool.query('SELECT 1');

    // 2. Verify MQ
    const conn = await getMqConnection();
    if (!conn) {
      throw new Error('MQ connection not active');
    }

    return res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    return res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

export { app };
