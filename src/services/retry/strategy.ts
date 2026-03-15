/**
 * 重試策略
 * 對應原始 Go 專案的 internal/relay/retry.go
 *
 * 功能：
 * - 指數退避（Exponential Backoff）
 * - 自適應重試（基於錯誤類型）
 * - 熔斷機制（Circuit Breaker）- 基礎版本
 */

/**
 * 錯誤類型分類
 */
export enum ErrorType {
  NetworkError = 'network_error', // 網路錯誤（可重試）
  RateLimitError = 'rate_limit_error', // 429 錯誤（需要退避）
  ServerError = 'server_error', // 5xx 錯誤（可重試）
  ClientError = 'client_error', // 4xx 錯誤（不可重試）
  TimeoutError = 'timeout_error', // 超時錯誤（可重試）
  AuthError = 'auth_error', // 認證錯誤（不可重試）
  Unknown = 'unknown', // 未知錯誤
}

/**
 * 重試配置
 */
export interface RetryConfig {
  maxRetries: number; // 最大重試次數
  initialDelayMs: number; // 初始延遲（毫秒）
  maxDelayMs: number; // 最大延遲（毫秒）
  multiplier: number; // 延遲倍數
  jitter: boolean; // 是否添加隨機抖動
}

/**
 * 預設重試配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000, // 1 秒
  maxDelayMs: 30000, // 30 秒
  multiplier: 2, // 指數倍數
  jitter: true, // 啟用抖動
};

/**
 * 根據 HTTP 狀態碼判斷錯誤類型
 */
export function classifyError(statusCode: number, errorMessage: string): ErrorType {
  // 429 限流錯誤
  if (statusCode === 429) {
    return ErrorType.RateLimitError;
  }

  // 401/403 認證錯誤
  if (statusCode === 401 || statusCode === 403) {
    return ErrorType.AuthError;
  }

  // 4xx 客戶端錯誤
  if (statusCode >= 400 && statusCode < 500) {
    return ErrorType.ClientError;
  }

  // 5xx 伺服器錯誤
  if (statusCode >= 500 && statusCode < 600) {
    return ErrorType.ServerError;
  }

  // 網路錯誤（根據錯誤訊息判斷）
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
 * 判斷錯誤是否可重試
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
      // 未知錯誤預設可重試
      return true;

    default:
      return false;
  }
}

/**
 * 計算重試延遲（指數退避 + 抖動）
 */
export function calculateRetryDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // 指數退避: delay = initialDelay * (multiplier ^ attempt)
  let delay = config.initialDelayMs * config.multiplier ** attempt;

  // 限制最大延遲
  delay = Math.min(delay, config.maxDelayMs);

  // 添加隨機抖動（± 25%）
  if (config.jitter) {
    const jitterRange = delay * 0.25;
    const jitter = Math.random() * jitterRange * 2 - jitterRange;
    delay += jitter;
  }

  return Math.floor(delay);
}

/**
 * 非同步延遲函數
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 重試策略類
 */
export class RetryStrategy {
  private config: RetryConfig;

  constructor(config: Partial<RetryConfig> = {}) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * 判斷是否應該重試
   */
  shouldRetry(attempt: number, errorType: ErrorType): { retry: boolean; delayMs: number } {
    // 超過最大重試次數
    if (attempt >= this.config.maxRetries) {
      return { retry: false, delayMs: 0 };
    }

    // 根據錯誤類型判斷
    if (!isRetryableError(errorType)) {
      return { retry: false, delayMs: 0 };
    }

    // 計算延遲
    const delayMs = calculateRetryDelay(attempt, this.config);

    return { retry: true, delayMs };
  }

  /**
   * 執行重試（帶延遲）
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

        // 調用錯誤回調
        if (onError) {
          onError(attempt, lastError);
        }

        // 最後一次嘗試，不再重試
        if (attempt === this.config.maxRetries) {
          break;
        }

        // 判斷錯誤類型
        const errorType = classifyError((err as any).statusCode || 0, lastError.message);

        // 判斷是否重試
        const { retry, delayMs } = this.shouldRetry(attempt, errorType);
        if (!retry) {
          break;
        }

        // 延遲後重試
        console.log(`Retry attempt ${attempt + 1}/${this.config.maxRetries} after ${delayMs}ms`);
        await delay(delayMs);
      }
    }

    throw lastError || new Error('Retry failed');
  }
}

// Circuit breaker implementation has been moved to:
// src/services/circuit-breaker/circuit-breaker.ts
