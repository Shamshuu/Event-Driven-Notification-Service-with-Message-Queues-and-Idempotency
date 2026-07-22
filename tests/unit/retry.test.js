import { getRetryDelay } from '../../src/utils/retryHelper.js';

describe('Retry Backoff Calculation Unit Tests', () => {
  const initialDelay = 1000;
  const backoffFactor = 5;

  test('should return 0 for non-positive attempts', () => {
    expect(getRetryDelay(0, initialDelay, backoffFactor)).toBe(0);
    expect(getRetryDelay(-1, initialDelay, backoffFactor)).toBe(0);
  });

  test('should calculate correct delay for attempt 1 (no backoff)', () => {
    const delay = getRetryDelay(1, initialDelay, backoffFactor);
    expect(delay).toBe(1000); // 1000 * 5^0
  });

  test('should calculate correct delay for attempt 2', () => {
    const delay = getRetryDelay(2, initialDelay, backoffFactor);
    expect(delay).toBe(5000); // 1000 * 5^1
  });

  test('should calculate correct delay for attempt 3', () => {
    const delay = getRetryDelay(3, initialDelay, backoffFactor);
    expect(delay).toBe(25000); // 1000 * 5^2
  });

  test('should respect different configuration parameters', () => {
    const delay = getRetryDelay(3, 500, 2);
    expect(delay).toBe(2000); // 500 * 2^2
  });
});
