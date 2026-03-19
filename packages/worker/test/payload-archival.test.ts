import { describe, it, expect, beforeEach } from "vitest";
import { env, SELF } from "cloudflare:test";
import { migrateDb, request, bootstrap } from "./helpers";
import { handleQueueBatch } from "../src/queue/consumer";
import type { QueueMessage } from "../src/lib/types";

beforeEach(async () => {
  await migrateDb();
  await bootstrap();
});

// Helper: create a source with no verification for simple webhook testing
async function createSource(name: string) {
  const res = await SELF.fetch(
    request("/api/v1/sources", { method: "POST", body: { name } }),
  );
  return (await res.json<{ data: { id: string } }>()).data;
}

describe("Ingress — payload archived to R2", () => {
  it("writes payload to R2 keyed by sourceId/eventId", async () => {
    const src = await createSource("r2-archive-test");
    const payload = { type: "order.created", data: { amount: 4200 } };

    const res = await SELF.fetch(
      request(`/webhooks/${src.id}`, { method: "POST", body: payload }),
    );
    expect(res.status).toBe(202);
    const { event_id } = await res.json<{ event_id: string }>();

    const obj = await env.PAYLOAD_BUCKET.get(`${src.id}/${event_id}`);
    expect(obj).not.toBeNull();

    const stored = await obj!.text();
    expect(JSON.parse(stored)).toEqual(payload);
  });

  it("accepts 150KB payload (exceeds 128KB queue limit, under 256KB ingress limit)", async () => {
    const src = await createSource("large-payload-test");

    // 150KB payload — would fail with old queue-embedded approach
    const largeBody = JSON.stringify({ data: "x".repeat(150 * 1024) });
    expect(largeBody.length).toBeGreaterThan(128 * 1024);
    expect(largeBody.length).toBeLessThan(256 * 1024);

    const res = await SELF.fetch(
      new Request(`http://localhost/webhooks/${src.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: largeBody,
      }),
    );
    expect(res.status).toBe(202);
    const { event_id } = await res.json<{ event_id: string }>();

    // Verify full payload is in R2
    const obj = await env.PAYLOAD_BUCKET.get(`${src.id}/${event_id}`);
    expect(obj).not.toBeNull();
    expect((await obj!.text()).length).toBe(largeBody.length);
  });

  // 413 rejection is already covered by security.test.ts
});

describe("Queue consumer — reads payloadR2Key from message", () => {
  it("creates event in D1 with correct payload_r2_key", async () => {
    // Set up source in D1
    const sourceId = "src_consumer_r2";
    await env.DB.prepare(
      "INSERT INTO sources (id, name) VALUES (?, ?)",
    ).bind(sourceId, "consumer-r2-src").run();

    // Pre-archive payload to R2 (as ingress does)
    const eventId = "evt_consumer_r2";
    const r2Key = `${sourceId}/${eventId}`;
    await env.PAYLOAD_BUCKET.put(r2Key, '{"type":"consumer.test"}');

    // Build mock MessageBatch with payloadR2Key (no raw payload)
    const acked: string[] = [];
    const batch = {
      queue: "test-queue",
      messages: [{
        id: "msg-1",
        timestamp: new Date(),
        attempts: 1,
        body: {
          eventId,
          sourceId,
          eventType: "consumer.test",
          payloadR2Key: r2Key,
          headers: { "content-type": "application/json" },
          idempotencyKey: null,
          receivedAt: new Date().toISOString(),
        } satisfies QueueMessage,
        ack: () => { acked.push(eventId); },
        retry: () => { throw new Error("unexpected retry"); },
      }],
      ackAll: () => {},
      retryAll: () => {},
    } as unknown as MessageBatch<QueueMessage>;

    await handleQueueBatch(batch, env);

    // Verify event was created in D1 with R2 key (not re-written to R2)
    const event = await env.DB.prepare(
      "SELECT * FROM events WHERE id = ?",
    ).bind(eventId).first();
    expect(event).not.toBeNull();
    expect(event!.payload_r2_key).toBe(r2Key);
    expect(event!.source_id).toBe(sourceId);
    expect(acked).toContain(eventId);
  });
});

describe("Replay — passes R2 key without re-fetching payload", () => {
  it("replays event using existing R2 key", async () => {
    const src = await createSource("replay-r2-test");

    // Manually create event + R2 payload (simulates post-ingress state)
    const eventId = `evt_replay_r2_${Date.now()}`;
    const r2Key = `${src.id}/${eventId}`;
    await env.PAYLOAD_BUCKET.put(r2Key, '{"type":"replay.test"}');
    await env.DB.prepare(
      "INSERT INTO events (id, source_id, event_type, payload_r2_key, headers) VALUES (?, ?, ?, ?, ?)",
    ).bind(eventId, src.id, "replay.test", r2Key, "{}").run();

    const res = await SELF.fetch(
      request(`/api/v1/events/${eventId}/replay`, { method: "POST" }),
    );
    expect(res.status).toBe(202);
    const body = await res.json<{ event_id: string }>();
    expect(body.event_id).toBe(eventId);
  });

  it("returns 404 when event has no R2 key", async () => {
    const src = await createSource("replay-no-r2-test");

    // Create event without R2 key (payload_r2_key is NULL)
    const eventId = `evt_no_r2_${Date.now()}`;
    await env.DB.prepare(
      "INSERT INTO events (id, source_id, event_type, headers) VALUES (?, ?, ?, ?)",
    ).bind(eventId, src.id, "test.event", "{}").run();

    const res = await SELF.fetch(
      request(`/api/v1/events/${eventId}/replay`, { method: "POST" }),
    );
    expect(res.status).toBe(404);
  });
});
