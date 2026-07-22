import { TransientError, PermanentError } from '../utils/errors.js';
import logger from '../utils/logger.js';

/**
 * Simulates external notification dispatch logic (Email, SMS, Push).
 * Recognizes testing flags in payload to mock transient or permanent failures.
 */
export async function dispatchNotification(event) {
  const { event_id, type, recipient, payload } = event;
  
  logger.info('Starting external notification dispatch simulation', { event_id, type, recipient });
  
  // Simulate external API call network latency
  await new Promise((resolve) => setTimeout(resolve, 100));
  
  if (payload && payload.simulate_transient_failure) {
    logger.warn('Mocking transient dispatch failure', { event_id });
    throw new TransientError('External notification provider timed out (Transient).');
  }
  
  if (payload && payload.simulate_permanent_failure) {
    logger.warn('Mocking permanent dispatch failure', { event_id });
    throw new PermanentError('Recipient address is blacklisted or invalid (Permanent).');
  }
  
  logger.info('Notification dispatch simulation successful', { event_id });
  return { success: true };
}
