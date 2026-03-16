import type { Env, DeliveryTask } from "../lib/types";
import { createDb, updateDelivery } from "../db/queries";
import { calculateRetryDelay, shouldRetryStatus } from "./retry";
import type { RetryConfig } from "./retry";
import { CircuitBreaker } from "./circuit-breaker";

/**
 * DeliveryManager Durable Object
 *
 * One instance per destination. Manages outbound delivery with
 * configurable retry strategies, circuit breaker, and the alarm API.
 */
export class DeliveryManager implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private circuitBreaker: CircuitBreaker;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.circuitBreaker = new CircuitBreaker(state.storage);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/deliver" && request.method === "POST") {
      const task: DeliveryTask = await request.json();
      await this.scheduleDelivery(task);
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/circuit" && request.method === "GET") {
      const state = await this.circuitBreaker.getState();
      const recoveryMs = await this.circuitBreaker.getRecoveryDelayMs();
      return new Response(JSON.stringify({ ...state, recovery_ms_remaining: recoveryMs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  private async scheduleDelivery(task: DeliveryTask): Promise<void> {
    const key = `task:${task.deliveryId}`;
    await this.state.storage.put(key, task);
    await this.attemptDelivery(task);
  }

  private async attemptDelivery(task: DeliveryTask): Promise<void> {
    const key = `task:${task.deliveryId}`;

    // Circuit breaker check
    const allowed = await this.circuitBreaker.allowRequest();
    if (!allowed) {
      // Circuit is open — schedule retry after recovery timeout
      const recoveryMs = await this.circuitBreaker.getRecoveryDelayMs();
      if (recoveryMs !== null && recoveryMs > 0) {
        await this.state.storage.setAlarm(Date.now() + recoveryMs);
      }
      return; // Skip this attempt, will retry when circuit is half-open
    }

    const startTime = Date.now();

    try {
      // Fetch payload from R2
      const payloadObj = await this.env.PAYLOAD_BUCKET.get(task.payloadR2Key);
      const payload = payloadObj ? await payloadObj.text() : "";

      // Build outbound request
      const headers: Record<string, string> = {
        "Content-Type": task.headers["content-type"] ?? "application/json",
        "User-Agent": "hookflare/0.1",
        "X-Hookflare-Event-Id": task.eventId,
        "X-Hookflare-Delivery-Id": task.deliveryId,
        "X-Hookflare-Attempt": String(task.attempt),
      };

      // Make the delivery request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), task.timeoutMs);

      const response = await fetch(task.destinationUrl, {
        method: "POST",
        headers,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const latencyMs = Date.now() - startTime;
      const responseBody = await response.text().then((t) => t.slice(0, 1024));

      if (response.ok) {
        // Success — reset circuit breaker
        await this.circuitBreaker.recordSuccess();
        await updateDelivery(createDb(this.env.DB), task.deliveryId, {
          status: "success",
          attempt: task.attempt,
          status_code: response.status,
          latency_ms: latencyMs,
          response_body: responseBody,
        });
        await this.state.storage.delete(key);
      } else {
        // Check if we should retry this status code
        if (!shouldRetryStatus(response.status, task.retryOnStatus ?? null)) {
          // Non-retryable status — go directly to DLQ
          await updateDelivery(createDb(this.env.DB), task.deliveryId, {
            status: "dlq",
            attempt: task.attempt,
            status_code: response.status,
            latency_ms: latencyMs,
            response_body: responseBody,
          });
          await this.state.storage.delete(key);
          return;
        }

        await this.circuitBreaker.recordFailure();

        // Check for Retry-After header from destination
        const retryAfter = this.parseRetryAfter(response.headers.get("Retry-After"));

        await this.handleFailure(task, response.status, latencyMs, responseBody, retryAfter);
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await this.circuitBreaker.recordFailure();
      await this.handleFailure(task, 0, latencyMs, errorMessage, null);
    }
  }

  private async handleFailure(
    task: DeliveryTask,
    statusCode: number,
    latencyMs: number,
    responseBody: string,
    retryAfterMs: number | null,
  ): Promise<void> {
    const key = `task:${task.deliveryId}`;

    if (task.attempt >= task.maxRetries) {
      // Exhausted retries — move to DLQ
      await updateDelivery(createDb(this.env.DB), task.deliveryId, {
        status: "dlq",
        attempt: task.attempt,
        status_code: statusCode || null,
        latency_ms: latencyMs,
        response_body: responseBody,
      });
      await this.state.storage.delete(key);
      return;
    }

    // Calculate next retry delay
    const retryConfig: RetryConfig = {
      strategy: task.retryStrategy ?? "exponential",
      maxRetries: task.maxRetries,
      intervalMs: task.retryIntervalMs ?? 60000,
      maxIntervalMs: task.retryMaxIntervalMs ?? 86400000,
    };

    // Retry-After header takes precedence (capped at 7 days)
    const maxRetryAfter = 7 * 24 * 60 * 60 * 1000;
    const delayMs = retryAfterMs
      ? Math.min(retryAfterMs, maxRetryAfter)
      : calculateRetryDelay(retryConfig, task.attempt);

    const nextRetryAt = new Date(Date.now() + delayMs);

    // Update delivery record
    await updateDelivery(createDb(this.env.DB), task.deliveryId, {
      status: "failed",
      attempt: task.attempt,
      status_code: statusCode || null,
      latency_ms: latencyMs,
      response_body: responseBody,
      next_retry_at: nextRetryAt.toISOString(),
    });

    // Update task for next attempt and store
    const updatedTask: DeliveryTask = { ...task, attempt: task.attempt + 1 };
    await this.state.storage.put(key, updatedTask);

    // Schedule alarm for retry (stagger by delivery ID to avoid thundering herd)
    const stagger = this.hashToOffset(task.deliveryId, 5000); // up to 5s stagger
    await this.state.storage.setAlarm(nextRetryAt.getTime() + stagger);
  }

  async alarm(): Promise<void> {
    // Process all pending tasks, but stagger them
    const entries = await this.state.storage.list<DeliveryTask>({ prefix: "task:" });

    for (const [, task] of entries) {
      await this.attemptDelivery(task);
    }
  }

  /**
   * Parse Retry-After header value to milliseconds.
   * Supports: integer seconds, HTTP date, ISO date.
   * Returns null if not parseable or not present.
   */
  private parseRetryAfter(value: string | null): number | null {
    if (!value) return null;

    // Integer seconds
    const seconds = parseInt(value, 10);
    if (!isNaN(seconds) && String(seconds) === value.trim()) {
      if (seconds === -1) return null; // -1 means "don't retry"
      return seconds * 1000;
    }

    // HTTP date or ISO date
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      const ms = date.getTime() - Date.now();
      return ms > 0 ? ms : null;
    }

    return null;
  }

  /**
   * Deterministic offset from delivery ID to stagger retries.
   */
  private hashToOffset(id: string, maxMs: number): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % maxMs;
  }
}
