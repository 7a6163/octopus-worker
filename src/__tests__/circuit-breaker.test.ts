import { describe, it, expect, beforeEach } from 'vitest';
import {
  CircuitState,
  isTripped,
  recordSuccess,
  recordFailure,
  getCooldownMs,
  clearAll,
  getEntryState,
  getEntryCount,
  type CircuitBreakerSettings,
} from '../services/circuit-breaker/circuit-breaker';

const DEFAULT_SETTINGS: CircuitBreakerSettings = {
  threshold: 5,
  cooldownSec: 60,
  maxCooldownSec: 600,
};

const CHANNEL_ID = 1;
const KEY_ID = 10;
const MODEL = 'gpt-4';

beforeEach(() => {
  clearAll();
});

describe('circuit breaker - state transitions', () => {
  it('starts in Closed state (no entry)', () => {
    const result = isTripped(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    expect(result.tripped).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('stays Closed below threshold', () => {
    for (let i = 0; i < 4; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    }
    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.Closed);
    expect(entry?.consecutiveFailures).toBe(4);

    const result = isTripped(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    expect(result.tripped).toBe(false);
  });

  it('transitions Closed -> Open at threshold', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    }
    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.Open);
    expect(entry?.tripCount).toBe(1);

    const result = isTripped(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    expect(result.tripped).toBe(true);
    expect(result.remainingMs).toBeGreaterThan(0);
  });

  it('transitions Open -> HalfOpen after cooldown', () => {
    // Trip the breaker
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    }

    // Use short cooldown settings to test transition
    const shortSettings: CircuitBreakerSettings = {
      threshold: 5,
      cooldownSec: 0, // 0 second cooldown for testing
      maxCooldownSec: 600,
    };

    // Re-trip with short settings so cooldown is 0
    clearAll();
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    }

    // Should transition to HalfOpen immediately
    const result = isTripped(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    expect(result.tripped).toBe(false); // Transitioned to HalfOpen, allows probe
    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.HalfOpen);
  });

  it('transitions HalfOpen -> Closed on success', () => {
    const shortSettings: CircuitBreakerSettings = {
      threshold: 5,
      cooldownSec: 0,
      maxCooldownSec: 600,
    };

    // Trip and transition to HalfOpen
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    }
    isTripped(CHANNEL_ID, KEY_ID, MODEL, shortSettings); // triggers Open -> HalfOpen

    // Record success
    recordSuccess(CHANNEL_ID, KEY_ID, MODEL);

    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.Closed);
    expect(entry?.consecutiveFailures).toBe(0);
    expect(entry?.tripCount).toBe(0);
  });

  it('transitions HalfOpen -> Open on failure (tripCount increments)', () => {
    const shortSettings: CircuitBreakerSettings = {
      threshold: 5,
      cooldownSec: 0,
      maxCooldownSec: 600,
    };

    // Trip and transition to HalfOpen
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    }
    isTripped(CHANNEL_ID, KEY_ID, MODEL, shortSettings);

    // Probe fails
    recordFailure(CHANNEL_ID, KEY_ID, MODEL, shortSettings);

    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.Open);
    expect(entry?.tripCount).toBe(2); // incremented from 1
    expect(entry?.consecutiveFailures).toBe(0); // reset
  });

  it('HalfOpen blocks concurrent requests', () => {
    const shortSettings: CircuitBreakerSettings = {
      threshold: 5,
      cooldownSec: 0,
      maxCooldownSec: 600,
    };

    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    }

    // First check transitions Open -> HalfOpen (allows probe)
    const first = isTripped(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    expect(first.tripped).toBe(false);

    // Second check should be blocked (HalfOpen only allows one probe)
    const second = isTripped(CHANNEL_ID, KEY_ID, MODEL, shortSettings);
    expect(second.tripped).toBe(true);
  });
});

describe('circuit breaker - success resets', () => {
  it('success resets failure count in Closed state', () => {
    recordFailure(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    recordFailure(CHANNEL_ID, KEY_ID, MODEL, DEFAULT_SETTINGS);
    recordSuccess(CHANNEL_ID, KEY_ID, MODEL);

    const entry = getEntryState(CHANNEL_ID, KEY_ID, MODEL);
    expect(entry?.state).toBe(CircuitState.Closed);
    expect(entry?.consecutiveFailures).toBe(0);
    expect(entry?.tripCount).toBe(0);
  });

  it('success on nonexistent entry is a no-op', () => {
    recordSuccess(999, 999, 'nonexistent');
    expect(getEntryCount()).toBe(0);
  });
});

describe('circuit breaker - cooldown calculation', () => {
  it('returns base cooldown for first trip', () => {
    expect(getCooldownMs(1, DEFAULT_SETTINGS)).toBe(60_000);
  });

  it('doubles cooldown for each subsequent trip', () => {
    expect(getCooldownMs(2, DEFAULT_SETTINGS)).toBe(120_000);
    expect(getCooldownMs(3, DEFAULT_SETTINGS)).toBe(240_000);
  });

  it('caps at maxCooldown', () => {
    // 60 * 2^10 = 61440 > 600 max
    expect(getCooldownMs(11, DEFAULT_SETTINGS)).toBe(600_000);
  });

  it('handles tripCount 0', () => {
    expect(getCooldownMs(0, DEFAULT_SETTINGS)).toBe(60_000);
  });

  it('prevents overflow with large trip count', () => {
    expect(getCooldownMs(100, DEFAULT_SETTINGS)).toBe(600_000);
  });
});

describe('circuit breaker - isolation', () => {
  it('different channels have independent breakers', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(1, KEY_ID, MODEL, DEFAULT_SETTINGS);
    }

    // Channel 1 is tripped
    expect(isTripped(1, KEY_ID, MODEL, DEFAULT_SETTINGS).tripped).toBe(true);
    // Channel 2 is not
    expect(isTripped(2, KEY_ID, MODEL, DEFAULT_SETTINGS).tripped).toBe(false);
  });

  it('different keys on same channel have independent breakers', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, 10, MODEL, DEFAULT_SETTINGS);
    }

    expect(isTripped(CHANNEL_ID, 10, MODEL, DEFAULT_SETTINGS).tripped).toBe(true);
    expect(isTripped(CHANNEL_ID, 20, MODEL, DEFAULT_SETTINGS).tripped).toBe(false);
  });

  it('different models on same channel+key have independent breakers', () => {
    for (let i = 0; i < 5; i++) {
      recordFailure(CHANNEL_ID, KEY_ID, 'gpt-4', DEFAULT_SETTINGS);
    }

    expect(isTripped(CHANNEL_ID, KEY_ID, 'gpt-4', DEFAULT_SETTINGS).tripped).toBe(true);
    expect(isTripped(CHANNEL_ID, KEY_ID, 'gpt-3.5', DEFAULT_SETTINGS).tripped).toBe(false);
  });
});

describe('circuit breaker - custom settings', () => {
  it('respects custom threshold', () => {
    const settings: CircuitBreakerSettings = {
      threshold: 2,
      cooldownSec: 60,
      maxCooldownSec: 600,
    };

    recordFailure(CHANNEL_ID, KEY_ID, MODEL, settings);
    expect(getEntryState(CHANNEL_ID, KEY_ID, MODEL)?.state).toBe(CircuitState.Closed);

    recordFailure(CHANNEL_ID, KEY_ID, MODEL, settings);
    expect(getEntryState(CHANNEL_ID, KEY_ID, MODEL)?.state).toBe(CircuitState.Open);
  });
});
