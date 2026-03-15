import type { Env, DeliveryTask } from "../lib/types";
import { updateDelivery } from "../db/queries";

/**
 * DeliveryManager Durable Object
 *
 * One instance per destination. Manages outbound delivery with
 * exponential backoff retries using the Durable Object alarm API.
 */
export class DeliveryManager implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/deliver" && request.method === "POST") {
      const task: DeliveryTask = await request.json();
      await this.scheduleDelivery(task);
      return new Response("OK", { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  }

  private async scheduleDelivery(task: DeliveryTask): Promise<void> {
    // Store the task and process immediately
    const key = `task:${task.deliveryId}`;
    await this.state.storage.put(key, task);

    // Process right away for first attempt
    await this.attemptDelivery(task);
  }

  private async attemptDelivery(task: DeliveryTask): Promise<void> {
    const key = `task:${task.deliveryId}`;
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
        // Success
        await updateDelivery(this.env.DB, task.deliveryId, {
          status: "success",
          attempt: task.attempt,
          status_code: response.status,
          latency_ms: latencyMs,
          response_body: responseBody,
        });
        await this.state.storage.delete(key);
      } else {
        // Failed — schedule retry
        await this.handleFailure(task, response.status, latencyMs, responseBody);
      }
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      await this.handleFailure(task, 0, latencyMs, errorMessage);
    }
  }

  private async handleFailure(
    task: DeliveryTask,
    statusCode: number,
    latencyMs: number,
    responseBody: string,
  ): Promise<void> {
    const key = `task:${task.deliveryId}`;

    if (task.attempt >= task.maxRetries) {
      // Exhausted retries — move to DLQ
      await updateDelivery(this.env.DB, task.deliveryId, {
        status: "dlq",
        attempt: task.attempt,
        status_code: statusCode || null,
        latency_ms: latencyMs,
        response_body: responseBody,
      });
      await this.state.storage.delete(key);
      return;
    }

    // Calculate next retry with exponential backoff + jitter
    const delay = Math.min(
      task.backoffBaseMs * Math.pow(2, task.attempt - 1),
      task.backoffMaxMs,
    );
    const jitter = delay * 0.2 * Math.random();
    const nextRetryMs = delay + jitter;
    const nextRetryAt = new Date(Date.now() + nextRetryMs);

    // Update delivery record
    await updateDelivery(this.env.DB, task.deliveryId, {
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

    // Schedule alarm for retry
    await this.state.storage.setAlarm(nextRetryAt.getTime());
  }

  async alarm(): Promise<void> {
    // Process all pending tasks
    const entries = await this.state.storage.list<DeliveryTask>({ prefix: "task:" });

    for (const [, task] of entries) {
      await this.attemptDelivery(task);
    }
  }
}
