import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request } from "./helpers";
import type { ExportData, ImportResult, Source, Destination, Subscription } from "@hookflare/shared";

beforeEach(async () => {
  await migrateDb();
});

async function seedConfig() {
  const srcRes = await SELF.fetch(
    request("/api/v1/sources", {
      method: "POST",
      body: { name: "stripe", verification: { type: "hmac-sha256", secret: "whsec_test" } },
    }),
  );
  const src = await srcRes.json<{ data: Source }>();

  const dstRes = await SELF.fetch(
    request("/api/v1/destinations", {
      method: "POST",
      body: { name: "my-app", url: "https://example.com/hook", retry_policy: { max_retries: 3 } },
    }),
  );
  const dst = await dstRes.json<{ data: Destination }>();

  await SELF.fetch(
    request("/api/v1/subscriptions", {
      method: "POST",
      body: { source_id: src.data.id, destination_id: dst.data.id, event_types: ["payment.*"] },
    }),
  );

  return { src: src.data, dst: dst.data };
}

describe("Export", () => {
  it("exports empty config", async () => {
    const res = await SELF.fetch(request("/api/v1/export"));
    expect(res.status).toBe(200);

    const body = await res.json<{ data: ExportData }>();
    expect(body.data.version).toBe("1");
    expect(body.data.exported_at).toBeTruthy();
    expect(body.data.sources).toHaveLength(0);
    expect(body.data.destinations).toHaveLength(0);
    expect(body.data.subscriptions).toHaveLength(0);
  });

  it("exports all configuration", async () => {
    await seedConfig();

    const res = await SELF.fetch(request("/api/v1/export"));
    const body = await res.json<{ data: ExportData }>();

    expect(body.data.sources).toHaveLength(1);
    expect(body.data.sources[0].name).toBe("stripe");
    expect(body.data.sources[0].verification_type).toBe("hmac-sha256");
    expect(body.data.destinations).toHaveLength(1);
    expect(body.data.destinations[0].name).toBe("my-app");
    expect(body.data.destinations[0].max_retries).toBe(3);
    expect(body.data.subscriptions).toHaveLength(1);
    expect(body.data.subscriptions[0].event_types).toBe('["payment.*"]');
  });
});

describe("Import", () => {
  it("imports into empty instance", async () => {
    const exportData: ExportData = {
      version: "1",
      exported_at: new Date().toISOString(),
      sources: [
        { id: "src_old1", name: "github", verification_type: "hmac-sha256", verification_secret: "secret123", created_at: "", updated_at: "" },
      ],
      destinations: [
        { id: "dst_old1", name: "backend", url: "https://api.example.com/hooks", timeout_ms: 5000, max_retries: 3, backoff_base_ms: 30000, backoff_max_ms: 86400000, created_at: "", updated_at: "" },
      ],
      subscriptions: [
        { id: "sub_old1", source_id: "src_old1", destination_id: "dst_old1", event_types: '["push"]', enabled: 1, created_at: "" },
      ],
    };

    const res = await SELF.fetch(
      request("/api/v1/import", { method: "POST", body: { data: exportData } }),
    );
    expect(res.status).toBe(200);

    const body = await res.json<{ data: ImportResult }>();
    expect(body.data.sources.created).toBe(1);
    expect(body.data.sources.skipped).toBe(0);
    expect(body.data.destinations.created).toBe(1);
    expect(body.data.destinations.skipped).toBe(0);
    expect(body.data.subscriptions.created).toBe(1);
    expect(body.data.subscriptions.skipped).toBe(0);

    // Verify imported data is queryable
    const sourcesRes = await SELF.fetch(request("/api/v1/sources"));
    const sources = await sourcesRes.json<{ data: Source[] }>();
    expect(sources.data).toHaveLength(1);
    expect(sources.data[0].name).toBe("github");
    // New ID should be generated (not old one)
    expect(sources.data[0].id).not.toBe("src_old1");
    expect(sources.data[0].id).toMatch(/^src_/);
  });

  it("skips duplicates by name", async () => {
    await seedConfig();

    const exportData: ExportData = {
      version: "1",
      exported_at: new Date().toISOString(),
      sources: [
        { id: "src_other", name: "stripe", verification_type: null, verification_secret: null, created_at: "", updated_at: "" },
        { id: "src_new", name: "shopify", verification_type: null, verification_secret: null, created_at: "", updated_at: "" },
      ],
      destinations: [
        { id: "dst_other", name: "my-app", url: "https://other.com", timeout_ms: 30000, max_retries: 5, backoff_base_ms: 30000, backoff_max_ms: 86400000, created_at: "", updated_at: "" },
      ],
      subscriptions: [],
    };

    const res = await SELF.fetch(
      request("/api/v1/import", { method: "POST", body: { data: exportData } }),
    );
    const body = await res.json<{ data: ImportResult }>();

    expect(body.data.sources.created).toBe(1);  // shopify
    expect(body.data.sources.skipped).toBe(1);  // stripe (exists)
    expect(body.data.destinations.skipped).toBe(1);  // my-app (exists)
  });

  it("re-links subscriptions to new IDs", async () => {
    const exportData: ExportData = {
      version: "1",
      exported_at: new Date().toISOString(),
      sources: [
        { id: "src_foreign_1", name: "src-relink", verification_type: null, verification_secret: null, created_at: "", updated_at: "" },
      ],
      destinations: [
        { id: "dst_foreign_1", name: "dst-relink", url: "https://relink.test", timeout_ms: 30000, max_retries: 5, backoff_base_ms: 30000, backoff_max_ms: 86400000, created_at: "", updated_at: "" },
      ],
      subscriptions: [
        { id: "sub_foreign_1", source_id: "src_foreign_1", destination_id: "dst_foreign_1", event_types: '["*"]', enabled: 1, created_at: "" },
      ],
    };

    await SELF.fetch(
      request("/api/v1/import", { method: "POST", body: { data: exportData } }),
    );

    // Verify subscription references the new (local) IDs
    const subsRes = await SELF.fetch(request("/api/v1/subscriptions"));
    const subs = await subsRes.json<{ data: Subscription[] }>();
    expect(subs.data).toHaveLength(1);
    expect(subs.data[0].source_id).toMatch(/^src_/);
    expect(subs.data[0].source_id).not.toBe("src_foreign_1");
    expect(subs.data[0].destination_id).toMatch(/^dst_/);
    expect(subs.data[0].destination_id).not.toBe("dst_foreign_1");
  });
});

describe("Export → Import roundtrip", () => {
  it("preserves configuration through export and re-import", async () => {
    // 1. Seed original config
    await seedConfig();

    // 2. Export
    const exportRes = await SELF.fetch(request("/api/v1/export"));
    const exported = await exportRes.json<{ data: ExportData }>();

    // 3. Delete everything
    const subsRes = await SELF.fetch(request("/api/v1/subscriptions"));
    const subs = await subsRes.json<{ data: Subscription[] }>();
    for (const sub of subs.data) {
      await SELF.fetch(request(`/api/v1/subscriptions/${sub.id}`, { method: "DELETE" }));
    }
    const srcsRes = await SELF.fetch(request("/api/v1/sources"));
    const srcs = await srcsRes.json<{ data: Source[] }>();
    for (const src of srcs.data) {
      await SELF.fetch(request(`/api/v1/sources/${src.id}`, { method: "DELETE" }));
    }
    const dstsRes = await SELF.fetch(request("/api/v1/destinations"));
    const dsts = await dstsRes.json<{ data: Destination[] }>();
    for (const dst of dsts.data) {
      await SELF.fetch(request(`/api/v1/destinations/${dst.id}`, { method: "DELETE" }));
    }

    // Verify empty
    const emptyCheck = await SELF.fetch(request("/api/v1/export"));
    const emptyData = await emptyCheck.json<{ data: ExportData }>();
    expect(emptyData.data.sources).toHaveLength(0);

    // 4. Re-import
    const importRes = await SELF.fetch(
      request("/api/v1/import", { method: "POST", body: { data: exported.data } }),
    );
    const importResult = await importRes.json<{ data: ImportResult }>();
    expect(importResult.data.sources.created).toBe(1);
    expect(importResult.data.destinations.created).toBe(1);
    expect(importResult.data.subscriptions.created).toBe(1);

    // 5. Export again and compare
    const reExportRes = await SELF.fetch(request("/api/v1/export"));
    const reExported = await reExportRes.json<{ data: ExportData }>();

    // Same data, different IDs and timestamps
    expect(reExported.data.sources).toHaveLength(1);
    expect(reExported.data.sources[0].name).toBe(exported.data.sources[0].name);
    expect(reExported.data.sources[0].verification_type).toBe(exported.data.sources[0].verification_type);
    expect(reExported.data.destinations).toHaveLength(1);
    expect(reExported.data.destinations[0].name).toBe(exported.data.destinations[0].name);
    expect(reExported.data.destinations[0].url).toBe(exported.data.destinations[0].url);
    expect(reExported.data.destinations[0].max_retries).toBe(exported.data.destinations[0].max_retries);
    expect(reExported.data.subscriptions).toHaveLength(1);
    expect(reExported.data.subscriptions[0].event_types).toBe(exported.data.subscriptions[0].event_types);
  });
});

describe("Import validation", () => {
  it("rejects missing data", async () => {
    const res = await SELF.fetch(
      request("/api/v1/import", { method: "POST", body: {} }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unsupported version", async () => {
    const res = await SELF.fetch(
      request("/api/v1/import", {
        method: "POST",
        body: { data: { version: "99", sources: [], destinations: [], subscriptions: [] } },
      }),
    );
    expect(res.status).toBe(400);
  });
});
