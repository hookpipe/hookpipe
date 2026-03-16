import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request, unauthRequest } from "./helpers";

beforeEach(async () => {
  await migrateDb();
});

describe("Health check — setup_required flag", () => {
  it("returns setup_required: true on fresh instance", async () => {
    const res = await SELF.fetch(request("/health"));
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; setup_required: boolean }>();
    expect(body.status).toBe("ok");
    expect(body.setup_required).toBe(true);
  });

  it("returns setup_required: false after bootstrap", async () => {
    // Bootstrap first
    await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );

    const res = await SELF.fetch(request("/health"));
    const body = await res.json<{ setup_required: boolean }>();
    expect(body.setup_required).toBe(false);
  });
});

describe("Bootstrap endpoint", () => {
  it("creates first admin key on fresh instance", async () => {
    const res = await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: { name: "my-admin" } }),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{
      data: { key: string; name: string; id: string; key_prefix: string };
      message: string;
    }>();

    expect(body.data.key).toMatch(/^hf_sk_/);
    expect(body.data.name).toBe("my-admin");
    expect(body.data.id).toMatch(/^key_/);
    expect(body.message).toContain("Store this key securely");
  });

  it("uses default name 'admin' when no name provided", async () => {
    const res = await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ data: { name: string } }>();
    expect(body.data.name).toBe("admin");
  });

  it("works with empty body", async () => {
    const res = await SELF.fetch(
      new Request("http://localhost/api/v1/bootstrap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(201);
  });

  it("returns 403 after first successful bootstrap", async () => {
    // First bootstrap
    await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );

    // Second attempt
    const res = await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: { name: "hacker" } }),
    );
    expect(res.status).toBe(403);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("BOOTSTRAP_COMPLETED");
  });
});

describe("Auth middleware — bootstrap mode", () => {
  it("returns SETUP_REQUIRED on unauthenticated request to fresh instance", async () => {
    const res = await SELF.fetch(request("/api/v1/sources"));
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toBe("SETUP_REQUIRED");
    expect(body.error.message).toContain("/api/v1/bootstrap");
  });

  it("allows access after bootstrap with returned key", async () => {
    // Bootstrap
    const bootstrapRes = await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );
    const { data } = await bootstrapRes.json<{ data: { key: string } }>();

    // Use the key
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        headers: { Authorization: `Bearer ${data.key}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(body.data).toHaveLength(0);
  });

  it("rejects invalid key after bootstrap", async () => {
    // Bootstrap
    await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );

    // Try with wrong key
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        headers: { Authorization: "Bearer hf_sk_invalid" },
      }),
    );
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unauthenticated request after bootstrap", async () => {
    // Bootstrap
    await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );

    // Try without key
    const res = await SELF.fetch(request("/api/v1/sources"));
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("Full bootstrap → use flow", () => {
  it("complete lifecycle: bootstrap → create source → list sources", async () => {
    // 1. Health shows setup required
    const healthBefore = await SELF.fetch(request("/health"));
    const hb = await healthBefore.json<{ setup_required: boolean }>();
    expect(hb.setup_required).toBe(true);

    // 2. Sources returns SETUP_REQUIRED
    const srcBefore = await SELF.fetch(request("/api/v1/sources"));
    expect(srcBefore.status).toBe(401);

    // 3. Bootstrap
    const bootstrapRes = await SELF.fetch(
      request("/api/v1/bootstrap", { method: "POST", body: {} }),
    );
    expect(bootstrapRes.status).toBe(201);
    const { data: { key } } = await bootstrapRes.json<{ data: { key: string } }>();

    // 4. Health shows setup no longer required
    const healthAfter = await SELF.fetch(request("/health"));
    const ha = await healthAfter.json<{ setup_required: boolean }>();
    expect(ha.setup_required).toBe(false);

    // 5. Create source with the key
    const createRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "test-source" },
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(createRes.status).toBe(201);

    // 6. List sources with the key
    const listRes = await SELF.fetch(
      request("/api/v1/sources", {
        headers: { Authorization: `Bearer ${key}` },
      }),
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json<{ data: { name: string }[] }>();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe("test-source");
  });
});
