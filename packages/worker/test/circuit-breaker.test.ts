import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker } from "../src/delivery/circuit-breaker";
import type { CircuitBreakerState } from "../src/delivery/circuit-breaker";

// Mock DurableObjectStorage
function createMockStorage(): DurableObjectStorage {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    put: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    list: vi.fn(async () => store),
  } as unknown as DurableObjectStorage;
}

describe("CircuitBreaker", () => {
  let storage: DurableObjectStorage;
  let cb: CircuitBreaker;

  beforeEach(() => {
    storage = createMockStorage();
    cb = new CircuitBreaker(storage);
  });

  describe("initial state", () => {
    it("starts closed", async () => {
      const state = await cb.getState();
      expect(state.state).toBe("closed");
      expect(state.failureCount).toBe(0);
    });

    it("allows requests when closed", async () => {
      expect(await cb.allowRequest()).toBe(true);
    });
  });

  describe("failure tracking", () => {
    it("stays closed under threshold", async () => {
      for (let i = 0; i < 9; i++) {
        const result = await cb.recordFailure();
        expect(result).toBe("closed");
      }
      const state = await cb.getState();
      expect(state.failureCount).toBe(9);
      expect(state.state).toBe("closed");
      expect(await cb.allowRequest()).toBe(true);
    });

    it("opens after 10 consecutive failures", async () => {
      for (let i = 0; i < 10; i++) {
        await cb.recordFailure();
      }
      const state = await cb.getState();
      expect(state.state).toBe("open");
      expect(state.failureCount).toBe(10);
      expect(state.openedAt).toBeTruthy();
    });

    it("rejects requests when open", async () => {
      for (let i = 0; i < 10; i++) {
        await cb.recordFailure();
      }
      expect(await cb.allowRequest()).toBe(false);
    });
  });

  describe("recovery", () => {
    it("resets to closed on success", async () => {
      for (let i = 0; i < 5; i++) {
        await cb.recordFailure();
      }
      await cb.recordSuccess();
      const state = await cb.getState();
      expect(state.state).toBe("closed");
      expect(state.failureCount).toBe(0);
    });

    it("transitions to half-open after recovery timeout", async () => {
      for (let i = 0; i < 10; i++) {
        await cb.recordFailure();
      }

      // Simulate time passing beyond recovery timeout (5 min)
      const state = await cb.getState();
      const pastTime = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      await (storage.put as ReturnType<typeof vi.fn>)(
        "circuit_breaker",
        { ...state, openedAt: pastTime },
      );
      // Clear cache
      (cb as unknown as { cachedState: null }).cachedState = null;

      // Should allow one probe request (half-open)
      expect(await cb.allowRequest()).toBe(true);
      const newState = await cb.getState();
      expect(newState.state).toBe("half_open");
    });

    it("closes on successful probe (half-open → closed)", async () => {
      // Set up half-open state directly
      await (storage.put as ReturnType<typeof vi.fn>)(
        "circuit_breaker",
        {
          state: "half_open",
          failureCount: 10,
          lastFailureAt: new Date().toISOString(),
          openedAt: new Date().toISOString(),
          halfOpenAt: new Date().toISOString(),
        } satisfies CircuitBreakerState,
      );
      (cb as unknown as { cachedState: null }).cachedState = null;

      await cb.recordSuccess();
      const state = await cb.getState();
      expect(state.state).toBe("closed");
      expect(state.failureCount).toBe(0);
    });

    it("reopens on failed probe (half-open → open)", async () => {
      await (storage.put as ReturnType<typeof vi.fn>)(
        "circuit_breaker",
        {
          state: "half_open",
          failureCount: 10,
          lastFailureAt: new Date().toISOString(),
          openedAt: new Date().toISOString(),
          halfOpenAt: new Date().toISOString(),
        } satisfies CircuitBreakerState,
      );
      (cb as unknown as { cachedState: null }).cachedState = null;

      const result = await cb.recordFailure();
      expect(result).toBe("open");
      const state = await cb.getState();
      expect(state.state).toBe("open");
      expect(state.failureCount).toBe(11);
    });
  });

  describe("half-open watchdog", () => {
    it("rejects requests during active probe", async () => {
      await (storage.put as ReturnType<typeof vi.fn>)(
        "circuit_breaker",
        {
          state: "half_open",
          failureCount: 10,
          lastFailureAt: new Date().toISOString(),
          openedAt: new Date().toISOString(),
          halfOpenAt: new Date().toISOString(),
        } satisfies CircuitBreakerState,
      );
      (cb as unknown as { cachedState: null }).cachedState = null;

      expect(await cb.allowRequest()).toBe(false);
    });

    it("reopens if probe is stuck too long (watchdog)", async () => {
      const staleTime = new Date(Date.now() - 60 * 1000).toISOString(); // 60s ago > 30s watchdog
      await (storage.put as ReturnType<typeof vi.fn>)(
        "circuit_breaker",
        {
          state: "half_open",
          failureCount: 10,
          lastFailureAt: staleTime,
          openedAt: staleTime,
          halfOpenAt: staleTime,
        } satisfies CircuitBreakerState,
      );
      (cb as unknown as { cachedState: null }).cachedState = null;

      // Watchdog fires → reopens circuit
      expect(await cb.allowRequest()).toBe(false);
      const state = await cb.getState();
      expect(state.state).toBe("open");
    });
  });

  describe("recovery delay", () => {
    it("returns null when closed", async () => {
      expect(await cb.getRecoveryDelayMs()).toBe(null);
    });

    it("returns remaining time when open", async () => {
      for (let i = 0; i < 10; i++) {
        await cb.recordFailure();
      }
      const delay = await cb.getRecoveryDelayMs();
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(5 * 60 * 1000);
    });
  });
});
