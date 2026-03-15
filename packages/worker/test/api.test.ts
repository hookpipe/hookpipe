import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request } from "./helpers";

beforeEach(async () => {
  await migrateDb();
});

describe("Health", () => {
  it("returns ok", async () => {
    const res = await SELF.fetch(request("/health"));
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe("ok");
  });
});

describe("Sources API", () => {
  it("creates and lists sources", async () => {
    // Create
    const createRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "stripe" },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{ data: { id: string; name: string } }>();
    expect(created.data.name).toBe("stripe");
    expect(created.data.id).toMatch(/^src_/);

    // List
    const listRes = await SELF.fetch(request("/api/v1/sources"));
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{ data: { id: string }[] }>();
    expect(list.data).toHaveLength(1);

    // Get
    const getRes = await SELF.fetch(request(`/api/v1/sources/${created.data.id}`));
    expect(getRes.status).toBe(200);

    // Delete
    const delRes = await SELF.fetch(
      request(`/api/v1/sources/${created.data.id}`, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);

    // Verify deleted
    const afterDel = await SELF.fetch(request(`/api/v1/sources/${created.data.id}`));
    expect(afterDel.status).toBe(404);
  });

  it("creates source with verification config", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "github",
          verification: { type: "hmac-sha256", secret: "whsec_test123" },
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { verification_type: string; verification_secret: string };
    }>();
    expect(body.data.verification_type).toBe("hmac-sha256");
    expect(body.data.verification_secret).toBe("whsec_test123");
  });

  it("returns 404 for non-existent source", async () => {
    const res = await SELF.fetch(request("/api/v1/sources/src_nonexistent"));
    expect(res.status).toBe(404);
  });
});

describe("Destinations API", () => {
  it("creates and lists destinations", async () => {
    const createRes = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: {
          name: "my-app",
          url: "https://example.com/webhooks",
          retry_policy: { max_retries: 3, timeout_ms: 5000 },
        },
      }),
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json<{
      data: { id: string; max_retries: number; timeout_ms: number };
    }>();
    expect(created.data.id).toMatch(/^dst_/);
    expect(created.data.max_retries).toBe(3);
    expect(created.data.timeout_ms).toBe(5000);

    // List
    const listRes = await SELF.fetch(request("/api/v1/destinations"));
    const list = await listRes.json<{ data: unknown[] }>();
    expect(list.data).toHaveLength(1);
  });

  it("returns 400 when url is missing", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "no-url" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Subscriptions API", () => {
  it("creates subscription linking source to destination", async () => {
    // Setup: create source and destination
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: { name: "src-test" } }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    const dstRes = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "dst-test", url: "https://example.com/hook" },
      }),
    );
    const dst = await dstRes.json<{ data: { id: string } }>();

    // Create subscription
    const subRes = await SELF.fetch(
      request("/api/v1/subscriptions", {
        method: "POST",
        body: {
          source_id: src.data.id,
          destination_id: dst.data.id,
          event_types: ["payment.*"],
        },
      }),
    );
    expect(subRes.status).toBe(201);
    const sub = await subRes.json<{ data: { id: string; event_types: string } }>();
    expect(sub.data.id).toMatch(/^sub_/);
    expect(sub.data.event_types).toBe('["payment.*"]');

    // List
    const listRes = await SELF.fetch(request("/api/v1/subscriptions"));
    const list = await listRes.json<{ data: unknown[] }>();
    expect(list.data).toHaveLength(1);

    // Delete
    const delRes = await SELF.fetch(
      request(`/api/v1/subscriptions/${sub.data.id}`, { method: "DELETE" }),
    );
    expect(delRes.status).toBe(200);
  });

  it("returns 404 when source does not exist", async () => {
    const dstRes = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "dst-orphan", url: "https://example.com" },
      }),
    );
    const dst = await dstRes.json<{ data: { id: string } }>();

    const res = await SELF.fetch(
      request("/api/v1/subscriptions", {
        method: "POST",
        body: { source_id: "src_fake", destination_id: dst.data.id },
      }),
    );
    expect(res.status).toBe(404);
  });
});

describe("Webhook Ingress", () => {
  it("accepts webhook and creates event", async () => {
    // Setup source
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: { name: "ingress-test" } }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    // Send webhook
    const webhookRes = await SELF.fetch(
      request(`/webhooks/${src.data.id}`, {
        method: "POST",
        body: { type: "order.created", data: { id: 123 } },
      }),
    );
    expect(webhookRes.status).toBe(202);
    const webhook = await webhookRes.json<{ event_id: string }>();
    expect(webhook.event_id).toMatch(/^evt_/);

    // Verify event was recorded
    const eventRes = await SELF.fetch(request(`/api/v1/events/${webhook.event_id}`));
    expect(eventRes.status).toBe(200);
    const event = await eventRes.json<{
      data: { event_type: string; source_id: string };
    }>();
    expect(event.data.event_type).toBe("order.created");
    expect(event.data.source_id).toBe(src.data.id);
  });

  it("returns 404 for unknown source", async () => {
    const res = await SELF.fetch(
      request("/webhooks/src_nonexistent", {
        method: "POST",
        body: { test: true },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("deduplicates by idempotency key", async () => {
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: { name: "idem-test" } }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    const headers = { "x-idempotency-key": "unique-key-123" };

    // First request
    const res1 = await SELF.fetch(
      request(`/webhooks/${src.data.id}`, {
        method: "POST",
        body: { type: "test" },
        headers,
      }),
    );
    expect(res1.status).toBe(202);

    // Duplicate request
    const res2 = await SELF.fetch(
      request(`/webhooks/${src.data.id}`, {
        method: "POST",
        body: { type: "test" },
        headers,
      }),
    );
    expect(res2.status).toBe(200);
    const body2 = await res2.json<{ message: string }>();
    expect(body2.message).toBe("Duplicate event ignored");
  });
});
