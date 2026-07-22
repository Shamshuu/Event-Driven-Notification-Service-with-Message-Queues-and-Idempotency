const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates a NotificationEvent schema.
 * Returns null if valid, or a string error message if invalid.
 */
export function validateNotificationEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Request body must be a JSON object';
  }
  
  const { event_id, type, recipient, payload, timestamp } = body;
  
  if (event_id === undefined || event_id === null) {
    return 'event_id is required';
  }
  if (typeof event_id !== 'string' || !UUID_REGEX.test(event_id)) {
    return 'event_id must be a valid UUID string';
  }
  
  if (type === undefined || type === null) {
    return 'type is required';
  }
  if (!['email', 'sms', 'push'].includes(type)) {
    return 'type must be one of: email, sms, push';
  }
  
  if (recipient === undefined || recipient === null) {
    return 'recipient is required';
  }
  if (typeof recipient !== 'string' || recipient.trim() === '') {
    return 'recipient must be a non-empty string';
  }
  
  if (payload === undefined || payload === null) {
    return 'payload is required';
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return 'payload must be a JSON object';
  }
  
  if (timestamp === undefined || timestamp === null) {
    return 'timestamp is required';
  }
  if (typeof timestamp !== 'string') {
    return 'timestamp must be a valid ISO 8601 string';
  }
  const parsedTime = Date.parse(timestamp);
  if (isNaN(parsedTime)) {
    return 'timestamp must be a valid ISO 8601 string';
  }
  
  return null;
}
export { UUID_REGEX };
