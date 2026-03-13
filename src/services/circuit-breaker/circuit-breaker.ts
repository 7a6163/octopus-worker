/**
 * Circuit Breaker（熔斷器）
 * 對應原始 Go 專案的 internal/relay/balancer/circuit.go
 *
 * 三態設計：
 * - Closed：正常通行，記錄連續失敗次數
 * - Open：熔斷中，拒絕所有請求直到冷卻結束
 * - HalfOpen：冷卻結束，允許單個試探請求
 *
 * 特性：
 * - 全域 Map 儲存，按 channelID:keyID:modelName 隔離
 * - 指數退避冷卻：baseCooldown * 2^(tripCount-1)，上限 maxCooldown
 * - 設定驅動：threshold/cooldown/maxCooldown 從 DB Settings 讀取
 *
 * 注意：Workers isolate 內的全域變數會在同一 isolate 生命週期內持續存在，
 * 與 Go 的 sync.Map 行為相似。isolate 重啟時狀態重置，這是可接受的。
 */

// ==================== 狀態定義 ====================

export enum CircuitState {
  Closed = 0,   // 正常通行
  Open = 1,     // 熔斷中，拒絕所有請求
  HalfOpen = 2, // 半開，僅允許單個試探請求
}

// ==================== 設定常數 ====================

export const SETTING_KEY_CIRCUIT_BREAKER_THRESHOLD = 'circuit_breaker_threshold';
export const SETTING_KEY_CIRCUIT_BREAKER_COOLDOWN = 'circuit_breaker_cooldown';
export const SETTING_KEY_CIRCUIT_BREAKER_MAX_COOLDOWN = 'circuit_breaker_max_cooldown';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SEC = 60;
const DEFAULT_MAX_COOLDOWN_SEC = 600;

// ==================== 條目型別 ====================

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number; // ms timestamp
  tripCount: number;       // 累計熔斷觸發次數（用於指數退避）
}

// ==================== 全域儲存 ====================

const globalBreaker = new Map<string, CircuitEntry>();

// ==================== 設定 ====================

/**
 * Circuit Breaker 運行時設定
 * 由 relay handler 在請求開始時從 DB/KV 讀取並注入
 */
export interface CircuitBreakerSettings {
  readonly threshold: number;
  readonly cooldownSec: number;
  readonly maxCooldownSec: number;
}

const DEFAULT_SETTINGS: CircuitBreakerSettings = {
  threshold: DEFAULT_THRESHOLD,
  cooldownSec: DEFAULT_COOLDOWN_SEC,
  maxCooldownSec: DEFAULT_MAX_COOLDOWN_SEC,
};

// ==================== Key 生成 ====================

function circuitKey(channelId: number, keyId: number, modelName: string): string {
  return `${channelId}:${keyId}:${modelName}`;
}

// ==================== 條目管理 ====================

function getOrCreateEntry(key: string): CircuitEntry {
  const existing = globalBreaker.get(key);
  if (existing) {
    return existing;
  }

  const entry: CircuitEntry = {
    state: CircuitState.Closed,
    consecutiveFailures: 0,
    lastFailureTime: 0,
    tripCount: 0,
  };
  globalBreaker.set(key, entry);
  return entry;
}

// ==================== 冷卻時間計算 ====================

/**
 * 計算當前冷卻時間（帶指數退避）
 * cooldown = baseCooldown * 2^(tripCount-1)，不超過 maxCooldown
 */
export function getCooldownMs(
  tripCount: number,
  settings: CircuitBreakerSettings = DEFAULT_SETTINGS
): number {
  const { cooldownSec, maxCooldownSec } = settings;

  let cooldown = cooldownSec;
  if (tripCount > 1) {
    const shift = Math.min(tripCount - 1, 20); // 防止溢出
    cooldown = cooldownSec * (1 << shift);
  }

  return Math.min(cooldown, maxCooldownSec) * 1000;
}

// ==================== 核心 API ====================

export interface TrippedResult {
  readonly tripped: boolean;
  readonly remainingMs: number;
}

/**
 * 檢查通道是否處於熔斷狀態
 *
 * @returns tripped=true 表示該通道應被跳過，remainingMs 為剩餘冷卻毫秒數
 */
export function isTripped(
  channelId: number,
  keyId: number,
  modelName: string,
  settings: CircuitBreakerSettings = DEFAULT_SETTINGS
): TrippedResult {
  const key = circuitKey(channelId, keyId, modelName);
  const entry = globalBreaker.get(key);

  if (!entry) {
    return { tripped: false, remainingMs: 0 };
  }

  switch (entry.state) {
    case CircuitState.Closed:
      return { tripped: false, remainingMs: 0 };

    case CircuitState.Open: {
      const cooldownMs = getCooldownMs(entry.tripCount, settings);
      const elapsed = Date.now() - entry.lastFailureTime;

      if (elapsed >= cooldownMs) {
        // 冷卻結束，轉為 HalfOpen
        entry.state = CircuitState.HalfOpen;
        console.log(
          `circuit breaker [${key}] Open -> HalfOpen (cooldown ${cooldownMs}ms elapsed)`
        );
        return { tripped: false, remainingMs: 0 };
      }

      // 仍在冷卻中
      return { tripped: true, remainingMs: cooldownMs - elapsed };
    }

    case CircuitState.HalfOpen:
      // 已有試探請求在進行中，拒絕其他請求
      return { tripped: true, remainingMs: 0 };

    default:
      return { tripped: false, remainingMs: 0 };
  }
}

/**
 * 記錄成功，重置熔斷器狀態
 */
export function recordSuccess(
  channelId: number,
  keyId: number,
  modelName: string
): void {
  const key = circuitKey(channelId, keyId, modelName);
  const entry = globalBreaker.get(key);

  if (!entry) {
    return;
  }

  if (entry.state === CircuitState.HalfOpen) {
    console.log(`circuit breaker [${key}] HalfOpen -> Closed (probe succeeded)`);
  }

  // 重置全部狀態
  entry.state = CircuitState.Closed;
  entry.consecutiveFailures = 0;
  entry.tripCount = 0;
}

/**
 * 記錄失敗，可能觸發熔斷
 */
export function recordFailure(
  channelId: number,
  keyId: number,
  modelName: string,
  settings: CircuitBreakerSettings = DEFAULT_SETTINGS
): void {
  const key = circuitKey(channelId, keyId, modelName);
  const entry = getOrCreateEntry(key);

  entry.lastFailureTime = Date.now();

  switch (entry.state) {
    case CircuitState.Closed: {
      entry.consecutiveFailures++;
      if (entry.consecutiveFailures >= settings.threshold) {
        entry.state = CircuitState.Open;
        entry.tripCount++;
        const cooldownMs = getCooldownMs(entry.tripCount, settings);
        console.warn(
          `circuit breaker [${key}] Closed -> Open ` +
            `(failures=${entry.consecutiveFailures} >= threshold=${settings.threshold}, ` +
            `tripCount=${entry.tripCount}, cooldown=${cooldownMs}ms)`
        );
      }
      break;
    }

    case CircuitState.HalfOpen: {
      // 試探失敗，重新進入 Open 狀態，tripCount 遞增（冷卻時間翻倍）
      entry.state = CircuitState.Open;
      entry.tripCount++;
      entry.consecutiveFailures = 0; // 重新開始計數
      const cooldownMs = getCooldownMs(entry.tripCount, settings);
      console.warn(
        `circuit breaker [${key}] HalfOpen -> Open ` +
          `(probe failed, tripCount=${entry.tripCount}, cooldown=${cooldownMs}ms)`
      );
      break;
    }

    case CircuitState.Open:
      // 理論上不應該在 Open 狀態下接收到失敗記錄（請求應被拒絕），
      // 但為安全起見仍更新失敗時間
      break;
  }
}

// ==================== 輔助 API ====================

/**
 * 取得全域熔斷器條目數（用於監控/除錯）
 */
export function getEntryCount(): number {
  return globalBreaker.size;
}

/**
 * 清除所有熔斷器狀態（用於測試）
 */
export function clearAll(): void {
  globalBreaker.clear();
}

/**
 * 取得特定條目的狀態（用於除錯）
 */
export function getEntryState(
  channelId: number,
  keyId: number,
  modelName: string
): CircuitEntry | undefined {
  const key = circuitKey(channelId, keyId, modelName);
  const entry = globalBreaker.get(key);
  if (!entry) {
    return undefined;
  }
  // 回傳副本避免外部修改
  return { ...entry };
}
