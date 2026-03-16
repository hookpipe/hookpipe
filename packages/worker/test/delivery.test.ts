import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { migrateDb, request, bootstrap } from "./helpers";
import { calculateRetryDelay, shouldRetryStatus } from "../src/delivery/retry";
import type { RetryConfig } from "../src/delivery/retry";
import { handleQueueBatch } from "../src/queue/consumer";
import { createDb } from "../src/db/queries";
import * as db from "../src/db/queries";
import { generateId } from "../src/lib/id";
import type { QueueMessage } from "../src/lib/types";

beforeEach(async () => {
  await migrateDb();
  await bootstrap();
});

describe("Retry delay calculation", () => {
  const exponentialConfig: RetryConfig = {
    strategy: "exponential",
    maxRetries: 10,
    intervalMs: 60000,
    maxIntervalMs: 86400000,
  };

  it("doubles delay with each attempt (exponential)", () => {
    const d1 = calculateRetryDelay(exponentialConfig, 1);
    const d2 = calculateRetryDelay(exponentialConfig, 2);
    const d3 = calculateRetryDelay(exponentialConfig, 3);

    // With 20% jitter, delay should be between base and base*1.2
    expect(d1).toBeGreaterThanOrEqual(60000);
    expect(d1).toBeLessThanOrEqual(72000);
    expect(d2).toBeGreaterThanOrEqual(120000);
    expect(d3).toBeGreaterThanOrEqual(240000);
  });

  it("caps at max interval", () => {
    const config: RetryConfig = { ...exponentialConfig, maxIntervalMs: 100000 };
    const delay = calculateRetryDelay(config, 20); // 2^19 * 60000 would be huge
    expect(delay).toBeLessThanOrEqual(120000); // 100000 + 20% jitter
  });

  it("uses constant interval for linear strategy", () => {
    const config: RetryConfig = { ...exponentialConfig, strategy: "linear", intervalMs: 30000 };
    expect(calculateRetryDelay(config, 1)).toBe(30000);
    expect(calculateRetryDelay(config, 5)).toBe(30000);
    expect(calculateRetryDelay(config, 10)).toBe(30000);
  });

  it("uses constant interval for fixed strategy", () => {
    const config: RetryConfig = { ...exponentialConfig, strategy: "fixed", intervalMs: 45000 };
    expect(calculateRetryDelay(config, 1)).toBe(45000);
    expect(calculateRetryDelay(config, 10)).toBe(45000);
  });
});

describe("Retry status code filtering", () => {
  it("retries all non-2xx when no filter configured", () => {
    expect(shouldRetryStatus(500, null)).toBe(true);
    expect(shouldRetryStatus(503, null)).toBe(true);
    expect(shouldRetryStatus(429, null)).toBe(true);
    expect(shouldRetryStatus(404, null)).toBe(true);
  });

  it("never retries 2xx", () => {
    expect(shouldRetryStatus(200, null)).toBe(false);
    expect(shouldRetryStatus(201, null)).toBe(false);
    expect(shouldRetryStatus(204, null)).toBe(false);
  });

  it("always retries network errors (status 0)", () => {
    expect(shouldRetryStatus(0, null)).toBe(true);
    expect(shouldRetryStatus(0, '["5xx"]')).toBe(true);
  });

  it("filters by status code pattern", () => {
    const filter = '["5xx","429"]';
    expect(shouldRetryStatus(500, filter)).toBe(true);
    expect(shouldRetryStatus(503, filter)).toBe(true);
    expect(shouldRetryStatus(429, filter)).toBe(true);
    expect(shouldRetryStatus(404, filter)).toBe(false);
    expect(shouldRetryStatus(401, filter)).toBe(false);
  });

  it("matches exact status codes", () => {
    expect(shouldRetryStatus(502, '["502"]')).toBe(true);
    expect(shouldRetryStatus(503, '["502"]')).toBe(false);
  });
});

describe("Event type matching in ingress → event flow", () => {
  it("ingress creates event and returns 202 for valid source", async () => {
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: { name: "flow-src" } }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    const webhookRes = await SELF.fetch(
      request(`/webhooks/${src.data.id}`, {
        method: "POST",
        body: { type: "order.created", data: { id: 1 } },
      }),
    );
    expect(webhookRes.status).toBe(202);

    const webhook = await webhookRes.json<{ event_id: string }>();
    const eventRes = await SELF.fetch(request(`/api/v1/events/${webhook.event_id}`));
    const event = await eventRes.json<{ data: { event_type: string; source_id: string } }>();
    expect(event.data.event_type).toBe("order.created");
    expect(event.data.source_id).toBe(src.data.id);
  });
});
