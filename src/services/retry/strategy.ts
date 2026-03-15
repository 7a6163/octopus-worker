/**
 * Retry strategy
 * Corresponds to internal/relay/retry.go in the original Go project
 *
 * Features:
 * - Exponential Backoff
 * - Adaptive retry (based on error type)
 * - Circuit Breaker - basic version
 */

/**
 * Error type classification
 */
export enum ErrorType {
  NetworkError = 'network_error', // Network error (retryable)
  RateLimitError = 'rate_limit_error', // 429 error (needs backoff)
  ServerError = 'server_error', // 5xx error (retryable)
  ClientError = 'client_error', // 4xx error (not retryable)
  TimeoutError = 'timeout_error', // Timeout error (retryable)
  AuthError = 'auth_error', // Auth error (not retryable)
  Unknown = 'unknown', // Unknown error
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxRetries: number; // Maximum retry attempts
  initialDelayMs: number; // Initial delay (milliseconds)
  maxDelayMs: number; // Maximum delay (milliseconds)
  multiplier: number; // Delay multiplier
  jitter: boolean; // Whether to add random jitter
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 second
  maxDelayMs: 30000, // 30 seconds
  multiplier: 2, // Exponential multiplier
  jitter: true, // Enable jitter
};

/**
 * Classify error type based on HTTP status code
 */
export function classifyError(statusCode: number, errorMessage: string): ErrorType {
  // 429 rate limit error
  if (statusCode === 429) {
    return ErrorType.RateLimitError;
  }

  // 401/403 auth error
  if (statusCode === 401 || statusCode === 403) {
    return ErrorType.AuthError;
  }

  // 4xx client error
  if (statusCode >= 400 && statusCode < 500) {
    return ErrorType.ClientError;
  }

  // 5xx server error
  if (statusCode >= 500 && statusCode < 600) {
    return ErrorType.ServerError;
  }

  // Network error (determined by error message)
  const networkKeywords = ['timeout', 'network', 'connection', 'ECONNREFUSED', 'ETIMEDOUT'];
  if (networkKeywords.some((keyword) => errorMessage.toLowerCase().includes(keyword))) {
    if (errorMessage.toLowerCase().includes('timeout')) {
      return ErrorType.TimeoutError;
    }
    return ErrorType.NetworkError;
  }

  return ErrorType.Unknown;
}

/**
 * Determine whether an error is retryable
 */
export function isRetryableError(errorType: ErrorType): boolean {
  switch (errorType) {
    case ErrorType.NetworkError:
    case ErrorType.ServerError:
    case ErrorType.TimeoutError:
    case ErrorType.RateLimitError:
      return true;

    case ErrorType.ClientError:
    case ErrorType.AuthError:
      return false;

    case ErrorType.Unknown:
      // Unknown errors are retryable by default
      return true;

    default:
      return false;
  }
}

/**
 * Calculate retry delay (exponential backoff + jitter)
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff: delay = initialDelay * (multiplier ^ attempt)
  let delay = config.initialDelayMs * config.multiplier ** attempt;

  // Cap at maximum delay
  delay = Math.min(delay, config.maxDelayMs);

  // Add random jitter (+/- 25%)
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    delay += jitter;
  }

  return Math.floor(delay);
}

/**
 * Async delay function
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry strategy class
 */
export class RetryStrategy {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Determine whether to retry
   */
  shouldRetry(attempt: number, errorType: ErrorType): { retry: boolean; delayMs: number } {
    // Exceeded maximum retry attempts
    if (attempt >= this.config.maxRetries) {
      return { retry: false, delayMs: 0 };
    }

    // Determine by error type
    if (!isRetryableError(errorType)) {
      return { retry: false, delayMs: 0 };
    }

    // Calculate delay
    const delayMs = calculateRetryDelay(attempt, this.config);

    return { retry: true, delayMs };
  }

  /**
   * Execute with retry (with delay)
   */
  async executeWithRetry<T>(
    fn: () => Promise<T>,
    onError?: (attempt: number, error: Error) => void
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;

        // Invoke error callback
        if (onError) {
          onError(attempt, lastError);
        }

        // Last attempt, do not retry
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Classify error type
        const errorType = classifyError((err as any).statusCode || 0, lastError.message);

        // Determine whether to retry
        const { retry, delayMs } = this.shouldRetry(attempt, errorType);
        if (!retry) {
          break;
        }

        // Delay before retrying
        console.log(`Retry attempt ${attempt + 1}/${this.config.maxRetries} after ${delayMs}ms`);
        await delay(delayMs);
      }
    }

    throw lastError || new Error('Retry failed');
  }
}

// Circuit breaker implementation has been moved to:
// src/services/circuit-breaker/circuit-breaker.ts
