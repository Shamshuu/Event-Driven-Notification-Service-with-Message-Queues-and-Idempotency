import { validateNotificationEvent } from '../../src/utils/validation.js';

describe('Notification Event Validation Unit Tests', () => {
  const getValidEvent = () => ({
    event_id: 'e15b3c5a-27e1-45a7-9b22-83b6f8749a2a',
    type: 'email',
    recipient: 'test@example.com',
    payload: { subject: 'Hello', body: 'World' },
    timestamp: '2026-07-22T12:00:00Z'
  });

  test('should pass for a valid event', () => {
    const event = getValidEvent();
    const result = validateNotificationEvent(event);
    expect(result).toBeNull();
  });

  test('should fail when event_id is missing', () => {
    const event = getValidEvent();
    delete event.event_id;
    const result = validateNotificationEvent(event);
    expect(result).toContain('event_id is required');
  });

  test('should fail when event_id is not a valid UUID', () => {
    const event = getValidEvent();
    event.event_id = 'not-a-uuid';
    const result = validateNotificationEvent(event);
    expect(result).toContain('event_id must be a valid UUID');
  });

  test('should fail when type is missing', () => {
    const event = getValidEvent();
    delete event.type;
    const result = validateNotificationEvent(event);
    expect(result).toContain('type is required');
  });

  test('should fail when type is invalid', () => {
    const event = getValidEvent();
    event.type = 'slack';
    const result = validateNotificationEvent(event);
    expect(result).toContain('type must be one of');
  });

  test('should fail when recipient is empty', () => {
    const event = getValidEvent();
    event.recipient = '   ';
    const result = validateNotificationEvent(event);
    expect(result).toContain('recipient must be a non-empty string');
  });

  test('should fail when payload is not an object', () => {
    const event = getValidEvent();
    event.payload = 'string-payload';
    const result = validateNotificationEvent(event);
    expect(result).toContain('payload must be a JSON object');
  });

  test('should fail when timestamp is missing', () => {
    const event = getValidEvent();
    delete event.timestamp;
    const result = validateNotificationEvent(event);
    expect(result).toContain('timestamp is required');
  });

  test('should fail when timestamp is not an ISO date string', () => {
    const event = getValidEvent();
    event.timestamp = 'invalid-date';
    const result = validateNotificationEvent(event);
    expect(result).toContain('timestamp must be a valid ISO 8601');
  });
});
