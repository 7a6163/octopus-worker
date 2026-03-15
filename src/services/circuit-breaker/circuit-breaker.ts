/**
 * Circuit Breaker
 * Corresponds to internal/relay/balancer/circuit.go in the original Go project
 *
 * Three-state design:
 * - Closed: Normal operation, tracks consecutive failure count
 * - Open: Tripped, rejects all requests until cooldown expires
 * - HalfOpen: Cooldown expired, allows a single probe request
 *
 * Features:
 * - Global Map storage, isolated by channelID:keyID:modelName
 * - Exponential backoff cooldown: baseCooldown * 2^(tripCount-1), capped at maxCooldown
 * - Config-driven: threshold/cooldown/maxCooldown read from DB Settings
 *
 * Note: Global variables within a Workers isolate persist for the isolate's lifetime,
 * similar to Go's sync.Map. State resets on isolate restart, which is acceptable.
 */

// ==================== State definitions ====================

export enum CircuitState {
  Closed = 0, // Normal operation
  Open = 1, // Tripped, rejects all requests
  HalfOpen = 2, // Half-open, allows only a single probe request
}

// ==================== Config constants ====================

export const SETTING_KEY_CIRCUIT_BREAKER_THRESHOLD = 'circuit_breaker_threshold';
export const SETTING_KEY_CIRCUIT_BREAKER_COOLDOWN = 'circuit_breaker_cooldown';
export const SETTING_KEY_CIRCUIT_BREAKER_MAX_COOLDOWN = 'circuit_breaker_max_cooldown';

const DEFAULT_THRESHOLD = 5;
const DEFAULT_COOLDOWN_SEC = 60;
const DEFAULT_MAX_COOLDOWN_SEC = 600;

// ==================== Entry type ====================

interface CircuitEntry {
  state: CircuitState;
  consecutiveFailures: number;
  lastFailureTime: number; // ms timestamp
  tripCount: number; // Cumulative trip count (for exponential backoff)
}

// ==================== Global storage ====================

const globalBreaker = new Map<string, CircuitEntry>();

// ==================== Settings ====================

/**
 * Circuit Breaker runtime settings
 * Injected by the relay handler at request start, read from DB/KV
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

// ==================== Key generation ====================

function circuitKey(channelId: number, keyId: number, modelName: string): string {
  return `${channelId}:${keyId}:${modelName}`;
}

// ==================== Entry management ====================

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

// ==================== Cooldown calculation ====================

/**
 * Calculate current cooldown duration (with exponential backoff)
 * cooldown = baseCooldown * 2^(tripCount-1), capped at maxCooldown
 */
export function getCooldownMs(
  tripCount: number,
  settings: CircuitBreakerSettings = DEFAULT_SETTINGS
): number {
  const { cooldownSec, maxCooldownSec } = settings;

  let cooldown = cooldownSec;
  if (tripCount > 1) {
    const shift = Math.min(tripCount - 1, 20); // Prevent overflow
    cooldown = cooldownSec * (1 << shift);
  }

  return Math.min(cooldown, maxCooldownSec) * 1000;
}

// ==================== Core API ====================

export interface TrippedResult {
  readonly tripped: boolean;
  readonly remainingMs: number;
}

/**
 * Check whether a channel is in tripped (open) state
 *
 * @returns tripped=true means this channel should be skipped; remainingMs is the remaining cooldown in milliseconds
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
        // Cooldown expired, transition to HalfOpen
        entry.state = CircuitState.HalfOpen;
        console.log(`circuit breaker [${key}] Open -> HalfOpen (cooldown ${cooldownMs}ms elapsed)`);
        return { tripped: false, remainingMs: 0 };
      }

      // Still cooling down
      return { tripped: true, remainingMs: cooldownMs - elapsed };
    }

    case CircuitState.HalfOpen:
      // A probe request is already in progress, reject other requests
      return { tripped: true, remainingMs: 0 };

    default:
      return { tripped: false, remainingMs: 0 };
  }
}

/**
 * Record success, reset circuit breaker state
 */
export function recordSuccess(channelId: number, keyId: number, modelName: string): void {
  const key = circuitKey(channelId, keyId, modelName);
  const entry = globalBreaker.get(key);

  if (!entry) {
    return;
  }

  if (entry.state === CircuitState.HalfOpen) {
    console.log(`circuit breaker [${key}] HalfOpen -> Closed (probe succeeded)`);
  }

  // Reset all state
  entry.state = CircuitState.Closed;
  entry.consecutiveFailures = 0;
  entry.tripCount = 0;
}

/**
 * Record failure, may trigger circuit breaker
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
      // Probe failed, re-enter Open state, increment tripCount (doubles cooldown)
      entry.state = CircuitState.Open;
      entry.tripCount++;
      entry.consecutiveFailures = 0; // Reset failure count
      const cooldownMs = getCooldownMs(entry.tripCount, settings);
      console.warn(
        `circuit breaker [${key}] HalfOpen -> Open ` +
          `(probe failed, tripCount=${entry.tripCount}, cooldown=${cooldownMs}ms)`
      );
      break;
    }

    case CircuitState.Open:
      // In theory, failures should not be recorded in Open state (requests should be rejected),
      // but we update the failure time as a safety measure
      break;
  }
}

// ==================== Helper API ====================

/**
 * Get global circuit breaker entry count (for monitoring/debugging)
 */
export function getEntryCount(): number {
  return globalBreaker.size;
}

/**
 * Clear all circuit breaker state (for testing)
 */
export function clearAll(): void {
  globalBreaker.clear();
}

/**
 * Get the state of a specific entry (for debugging)
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
  // Return a copy to prevent external mutation
  return { ...entry };
}
