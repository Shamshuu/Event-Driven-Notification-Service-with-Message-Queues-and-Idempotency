import { getDbPool } from './db.js';
import logger from '../utils/logger.js';

/**
 * Attempts to acquire processing lease for an event.
 * Returns:
 * - 'ACQUIRED': Lease successfully taken, consumer should process the event.
 * - 'COMPLETED': Event was already processed successfully. Acknowledge and exit.
 * - 'FAILED': Event was processed and failed permanently. Acknowledge and exit.
 * - 'PROCESSING': Another consumer is currently handling this event. Re-queue/wait.
 */
export async function acquireLease(eventId) {
  const pool = getDbPool();
  
  try {
    // Attempt atomic insertion
    await pool.query(
      'INSERT INTO processed_events (event_id, status) VALUES (?, ?)',
      [eventId, 'PROCESSING']
    );
    logger.debug('Acquired processing lease (new event)', { event_id: eventId });
    return 'ACQUIRED';
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      // Event already exists, check status
      const [rows] = await pool.query(
        'SELECT status FROM processed_events WHERE event_id = ?',
        [eventId]
      );
      
      if (rows.length === 0) {
        // Race condition: row was deleted or modified in between. Retry.
        return acquireLease(eventId);
      }
      
      const currentStatus = rows[0].status;
      if (currentStatus === 'COMPLETED') {
        logger.debug('Event already completed', { event_id: eventId });
        return 'COMPLETED';
      }
      if (currentStatus === 'FAILED') {
        logger.debug('Event already marked as permanently failed', { event_id: eventId });
        return 'FAILED';
      }
      if (currentStatus === 'PROCESSING') {
        logger.debug('Event is currently being processed by another consumer', { event_id: eventId });
        return 'PROCESSING';
      }
      if (currentStatus === 'PENDING') {
        // Try to update status from PENDING to PROCESSING atomically
        const [result] = await pool.query(
          'UPDATE processed_events SET status = ? WHERE event_id = ? AND status = ?',
          ['PROCESSING', eventId, 'PENDING']
        );
        if (result.affectedRows > 0) {
          logger.debug('Acquired processing lease (retrying event)', { event_id: eventId });
          return 'ACQUIRED';
        } else {
          // Another thread updated it first
          logger.debug('Conflict updating PENDING event to PROCESSING', { event_id: eventId });
          return 'PROCESSING';
        }
      }
    }
    
    // Rethrow database errors so they can be handled as transient errors by the consumer
    throw error;
  }
}

/**
 * Updates the processing status of an event.
 */
export async function updateEventStatus(eventId, status) {
  const pool = getDbPool();
  await pool.query(
    'UPDATE processed_events SET status = ? WHERE event_id = ?',
    [status, eventId]
  );
  logger.debug('Updated event status', { event_id: eventId, status });
}

/**
 * Inserts a log into notification_logs.
 */
export async function logNotification(eventId, recipient, type, payload, status) {
  const pool = getDbPool();
  await pool.query(
    'INSERT INTO notification_logs (event_id, recipient, type, message_payload, status) VALUES (?, ?, ?, ?, ?)',
    [eventId, recipient, type, JSON.stringify(payload), status]
  );
  logger.debug('Logged notification dispatch', { event_id: eventId, status });
}
