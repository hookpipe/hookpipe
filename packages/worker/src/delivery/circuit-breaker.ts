/**
 * Circuit breaker for destination health tracking.
 *
 * States:
 * - CLOSED:    normal operation, deliveries flow through
 * - OPEN:      destination is down, deliveries are paused
 * - HALF_OPEN: probing with a single request to see if destination recovered
 *
 * Stored in Durable Object storage (per-destination).
 */

export type CircuitState = "closed" | "open" | "half_open";

export interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: string | null;
  openedAt: string | null;
  halfOpenAt: string | null;
}

const DEFAULT_STATE: CircuitBreakerState = {
  state: "closed",
  failureCount: 0,
  lastFailureAt: null,
  openedAt: null,
  halfOpenAt: null,
};

// Open circuit after this many consecutive failures
const FAILURE_THRESHOLD = 10;
// Wait this long before probing (half-open)
const RECOVERY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
// If a half-open probe doesn't resolve within this time, force re-evaluate
const HALF_OPEN_WATCHDOG_MS = 30 * 1000; // 30 seconds

const STORAGE_KEY = "circuit_breaker";

export class CircuitBreaker {
  private storage: DurableObjectStorage;
  private cachedState: CircuitBreakerState | null = null;

  constructor(storage: DurableObjectStorage) {
    this.storage = storage;
  }

  async getState(): Promise<CircuitBreakerState> {
    if (!this.cachedState) {
      this.cachedState =
        (await this.storage.get<CircuitBreakerState>(STORAGE_KEY)) ?? { ...DEFAULT_STATE };
    }
    return this.cachedState;
  }

  private async setState(state: CircuitBreakerState): Promise<void> {
    this.cachedState = state;
    await this.storage.put(STORAGE_KEY, state);
  }

  /**
   * Check if delivery should proceed.
   * Returns true if circuit allows the request.
   */
  async allowRequest(): Promise<boolean> {
    const state = await this.getState();

    switch (state.state) {
      case "closed":
        return true;

      case "open": {
        // Check if recovery timeout has passed → transition to half-open
        if (state.openedAt) {
          const elapsed = Date.now() - new Date(state.openedAt).getTime();
          if (elapsed >= RECOVERY_TIMEOUT_MS) {
            await this.setState({
              ...state,
              state: "half_open",
              halfOpenAt: new Date().toISOString(),
            });
            return true; // Allow one probe request
          }
        }
        return false; // Still open, reject
      }

      case "half_open": {
        // Check if the probe has been stuck too long (watchdog)
        if (state.halfOpenAt) {
          const elapsed = Date.now() - new Date(state.halfOpenAt).getTime();
          if (elapsed >= HALF_OPEN_WATCHDOG_MS) {
            // Probe timed out — reopen circuit and schedule recovery
            await this.setState({
              ...state,
              state: "open",
              openedAt: new Date().toISOString(),
              halfOpenAt: null,
            });
            return false;
          }
        }
        // Probe is in-flight, don't allow more requests
        return false;
      }

      default:
        return true;
    }
  }

  /**
   * Record a successful delivery.
   */
  async recordSuccess(): Promise<void> {
    await this.setState({ ...DEFAULT_STATE });
  }

  /**
   * Record a failed delivery.
   * Returns the new circuit state.
   */
  async recordFailure(): Promise<CircuitState> {
    const state = await this.getState();
    const now = new Date().toISOString();

    if (state.state === "half_open") {
      // Probe failed — reopen circuit
      await this.setState({
        state: "open",
        failureCount: state.failureCount + 1,
        lastFailureAt: now,
        openedAt: now,
        halfOpenAt: null,
      });
      return "open";
    }

    const newCount = state.failureCount + 1;

    if (newCount >= FAILURE_THRESHOLD) {
      // Threshold exceeded — open circuit
      await this.setState({
        state: "open",
        failureCount: newCount,
        lastFailureAt: now,
        openedAt: now,
        halfOpenAt: null,
      });
      return "open";
    }

    // Still under threshold
    await this.setState({
      ...state,
      failureCount: newCount,
      lastFailureAt: now,
    });
    return "closed";
  }

  /**
   * Get the time in ms until the circuit should re-evaluate.
   * Works for both open (recovery timeout) and half_open (watchdog timeout).
   */
  async getRecoveryDelayMs(): Promise<number | null> {
    const state = await this.getState();

    if (state.state === "open" && state.openedAt) {
      const elapsed = Date.now() - new Date(state.openedAt).getTime();
      const remaining = RECOVERY_TIMEOUT_MS - elapsed;
      return remaining > 0 ? remaining : 0;
    }

    if (state.state === "half_open" && state.halfOpenAt) {
      const elapsed = Date.now() - new Date(state.halfOpenAt).getTime();
      const remaining = HALF_OPEN_WATCHDOG_MS - elapsed;
      return remaining > 0 ? remaining : 0;
    }

    return null;
  }
}
