import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request } from "./helpers";

beforeEach(async () => {
  await migrateDb();
});

describe("Source validation", () => {
  it("rejects empty name", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: { name: "" } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing name field", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects name exceeding 100 chars", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "a".repeat(101) },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid source with verification", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "valid-src", verification: { type: "stripe", secret: "whsec_test" } },
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects verification with empty type", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "bad-verify", verification: { type: "", secret: "sec" } },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Destination validation", () => {
  it("rejects missing url", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "no-url" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid url", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "bad-url", url: "not-a-url" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ error: { message: string } }>();
    expect(body.error.message).toContain("url");
  });

  it("rejects url as number", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "num-url", url: 12345 },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects max_retries exceeding 50", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: {
          name: "too-many-retries",
          url: "https://example.com/hooks",
          retry_policy: { max_retries: 100 },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects invalid retry strategy", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: {
          name: "bad-strategy",
          url: "https://example.com/hooks",
          retry_policy: { strategy: "turbo" },
        },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid destination with retry policy", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: {
          name: "valid-dst",
          url: "https://example.com/hooks",
          retry_policy: {
            strategy: "linear",
            max_retries: 5,
            interval_ms: 30000,
            timeout_ms: 10000,
            on_status: ["5xx", "429"],
          },
        },
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Subscription validation", () => {
  it("rejects missing source_id", async () => {
    const res = await SELF.fetch(
      request("/api/v1/subscriptions", {
        method: "POST",
        body: { destination_id: "dst_xxx" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty source_id", async () => {
    const res = await SELF.fetch(
      request("/api/v1/subscriptions", {
        method: "POST",
        body: { source_id: "", destination_id: "dst_xxx" },
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("API key validation", () => {
  it("rejects missing name", async () => {
    const res = await SELF.fetch(
      request("/api/v1/keys", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects empty name", async () => {
    const res = await SELF.fetch(
      request("/api/v1/keys", { method: "POST", body: { name: "" } }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid key creation", async () => {
    const res = await SELF.fetch(
      request("/api/v1/keys", {
        method: "POST",
        body: { name: "test-key", scopes: ["admin"] },
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Import validation", () => {
  it("rejects invalid version", async () => {
    const res = await SELF.fetch(
      request("/api/v1/import", {
        method: "POST",
        body: { data: { version: "99", sources: [], destinations: [], subscriptions: [] } },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects non-object body", async () => {
    const res = await SELF.fetch(
      request("/api/v1/import", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("Validation error format (agent-friendly)", () => {
  it("returns structured error with code and details", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "x", url: "bad" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json<{
      error: { message: string; code: string; details: unknown[] };
    }>();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details)).toBe(true);
    expect(body.error.details.length).toBeGreaterThan(0);
  });
});
