/**
 * PLATORIA PRINT AGENT — RETRY & BACKOFF POLICY
 * ==============================================
 * Exponential backoff with jitter and Retry-After support.
 */

export interface RetryPolicyOptions {
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
}

export class RetryPolicy {
  private initialDelayMs: number;
  private maxDelayMs: number;
  private factor: number;
  private jitter: boolean;
  private attempts: number = 0;

  constructor(options: RetryPolicyOptions = {}) {
    this.initialDelayMs = options.initialDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.factor = options.factor ?? 1.5;
    this.jitter = options.jitter ?? true;
  }

  /**
   * Resets the retry counter upon successful operation
   */
  public reset(): void {
    this.attempts = 0;
  }

  /**
   * Increments attempt count and calculates the next sleep duration in milliseconds
   */
  public nextDelayMs(retryAfterHeader?: string | null): number {
    this.attempts++;

    // Check for standard HTTP Retry-After header
    if (retryAfterHeader) {
      const seconds = parseInt(retryAfterHeader, 10);
      if (!isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, this.maxDelayMs);
      }
      const date = Date.parse(retryAfterHeader);
      if (!isNaN(date)) {
        const diff = date - Date.now();
        if (diff > 0) {
          return Math.min(diff, this.maxDelayMs);
        }
      }
    }

    let delay = this.initialDelayMs * Math.pow(this.factor, this.attempts - 1);
    delay = Math.min(delay, this.maxDelayMs);

    if (this.jitter) {
      // Add random jitter between 0% and 30% to prevent synchronized thundering herds
      const jitterFactor = 1 + Math.random() * 0.3;
      delay = Math.round(delay * jitterFactor);
    }

    return Math.min(delay, this.maxDelayMs);
  }

  public getAttempts(): number {
    return this.attempts;
  }
}
