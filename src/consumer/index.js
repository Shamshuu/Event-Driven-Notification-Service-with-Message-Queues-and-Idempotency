import { getMqChannel } from '../services/mq.js';
import { acquireLease, updateEventStatus, logNotification } from '../services/idempotency.js';
import { dispatchNotification } from '../services/dispatch.js';
import { publishToRetryQueue, publishToDlq } from '../services/mq.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { validateNotificationEvent } from '../utils/validation.js';

/**
 * Starts consuming events from the notification queue.
 */
export async function startConsumer() {
  const ch = await getMqChannel();
  const queueName = config.mq.queueName;
  
  // Set prefetch to 1 to ensure load distribution and safe transactional boundaries
  await ch.prefetch(1);
  
  logger.info('Subscribing consumer to queue', { queue: queueName });
  
  await ch.consume(queueName, async (msg) => {
    if (!msg) return;
    
    let event = null;
    let eventId = 'unknown';
    
    try {
      const msgContent = msg.content.toString();
      event = JSON.parse(msgContent);
      eventId = event.event_id || 'unknown';
      
      logger.info('Consumed message from queue', { event_id: eventId });
      
      // 1. Basic Schema Validation
      const validationError = validateNotificationEvent(event);
      if (validationError) {
        logger.warn('Consumer received malformed payload', { event_id: eventId, error: validationError });
        await handlePermanentFailure(msg, event, 0, new Error(`Validation Error: ${validationError}`));
        return;
      }
      
      // 2. Idempotency Check
      const leaseStatus = await acquireLease(eventId);
      
      if (leaseStatus === 'COMPLETED') {
        logger.info('Message already processed successfully. Acknowledging duplicate.', { event_id: eventId });
        ch.ack(msg);
        return;
      }
      
      if (leaseStatus === 'FAILED') {
        logger.info('Message already failed permanently. Acknowledging and discarding.', { event_id: eventId });
        ch.ack(msg);
        return;
      }
      
      if (leaseStatus === 'PROCESSING') {
        logger.info('Message is currently being processed by another worker. Requeuing.', { event_id: eventId });
        ch.nack(msg, false, true); // requeue = true
        return;
      }
      
      // 3. Process dispatch logic
      try {
        await dispatchNotification(event);
        
        // 4. Update status and log to DB
        await updateEventStatus(eventId, 'COMPLETED');
        await logNotification(eventId, event.recipient, event.type, event.payload, 'SENT');
        
        ch.ack(msg);
        logger.info('Successfully processed and acknowledged message', { event_id: eventId });
      } catch (dispatchError) {
        const headers = msg.properties.headers || {};
        const retryCount = parseInt(headers['x-retry-count'] || '0', 10);
        
        if (dispatchError.isTransient) {
          await handleTransientFailure(msg, event, retryCount, dispatchError);
        } else {
          await handlePermanentFailure(msg, event, retryCount, dispatchError);
        }
      }
      
    } catch (error) {
      logger.error('Unexpected consumer error or transient database failure', {
        event_id: eventId,
        error: error.message
      });
      // Re-queue message since it couldn't be evaluated correctly due to external infrastructure issue
      try {
        ch.nack(msg, false, true);
      } catch (nackError) {
        logger.error('Failed to nack message after processing exception', { error: nackError.message });
      }
    }
  });
}

/**
 * Handles transient failures by updating database state to PENDING and publishing to next retry queue.
 */
async function handleTransientFailure(msg, event, retryCount, error) {
  const ch = await getMqChannel();
  const eventId = event.event_id;
  const maxRetries = config.retry.maxRetries;
  
  if (retryCount < maxRetries) {
    const nextRetry = retryCount + 1;
    logger.warn('Transient error encountered. Retrying...', {
      event_id: eventId,
      error: error.message,
      attempt: nextRetry,
      maxRetries
    });
    
    // Reset status to PENDING so next acquireLease is permitted
    await updateEventStatus(eventId, 'PENDING');
    
    // Publish to the retry delay queue
    await publishToRetryQueue(event, nextRetry);
    
    // Acknowledge the current queue message since it has been safely re-routed
    ch.ack(msg);
  } else {
    logger.error('Max retries exhausted for transient error', {
      event_id: eventId,
      attempts: retryCount,
      error: error.message
    });
    
    await updateEventStatus(eventId, 'FAILED');
    await logNotification(eventId, event.recipient, event.type, event.payload, 'DLQ_MOVED');
    await publishToDlq(event, retryCount, `Max retries exhausted: ${error.message}`);
    
    ch.ack(msg);
  }
}

/**
 * Handles permanent failures by moving message directly to DLQ.
 */
async function handlePermanentFailure(msg, event, retryCount, error) {
  const ch = await getMqChannel();
  const eventId = event ? event.event_id : 'unknown';
  
  logger.error('Permanent error encountered. Forwarding directly to DLQ.', {
    event_id: eventId,
    error: error.message
  });
  
  if (event && eventId !== 'unknown') {
    await updateEventStatus(eventId, 'FAILED');
    await logNotification(eventId, event.recipient, event.type, event.payload, 'DLQ_MOVED');
  }
  
  await publishToDlq(event || { raw: msg.content.toString() }, retryCount, error.message);
  ch.ack(msg);
}
