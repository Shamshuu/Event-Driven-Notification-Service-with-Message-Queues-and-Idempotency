export class TransientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TransientError';
    this.isTransient = true;
  }
}

export class PermanentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PermanentError';
    this.isTransient = false;
  }
}
