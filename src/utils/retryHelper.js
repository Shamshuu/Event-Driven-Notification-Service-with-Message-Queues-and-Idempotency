/**
 * Calculates backoff delay exponentially.
 * Formula: initialDelay * (backoffFactor ^ (attempt - 1))
 */
export function getRetryDelay(attempt, initialDelay, backoffFactor) {
  if (attempt < 1) return 0;
  return initialDelay * Math.pow(backoffFactor, attempt - 1);
}
