import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request } from "./helpers";
import { maskSecret } from "../src/lib/mask";
import type { ExportData } from "@hookflare/shared";

beforeEach(async () => {
  await migrateDb();
});

describe("maskSecret utility", () => {
  it("masks long secrets showing last 4 chars", () => {
    expect(maskSecret("whsec_live_abc123xyz")).toBe("****3xyz");
  });

  it("masks medium secrets showing last 4 chars", () => {
    expect(maskSecret("short1")).toBe("****ort1");
  });

  it("masks secrets with exactly 5 chars", () => {
    expect(maskSecret("abcde")).toBe("****bcde");
  });

  it("masks secrets with exactly 4 chars", () => {
    expect(maskSecret("abcd")).toBe("****");
  });

  it("masks secrets shorter than 4 chars", () => {
    expect(maskSecret("ab")).toBe("****");
  });

  it("returns null for null", () => {
    expect(maskSecret(null)).toBe(null);
  });

  it("returns null for undefined", () => {
    expect(maskSecret(undefined)).toBe(null);
  });

  it("returns null for empty string", () => {
    expect(maskSecret("")).toBe(null);
  });
});

describe("Source API secret masking", () => {
  const SECRET = "whsec_test_secret_value_12345";

  it("POST /sources returns full secret on creation", async () => {
    const res = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "stripe-create-test",
          verification: { type: "stripe", secret: SECRET },
        },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json<{ data: { verification_secret: string } }>();
    expect(body.data.verification_secret).toBe(SECRET);
  });

  it("GET /sources/:id returns masked secret", async () => {
    // Create
    const createRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "stripe-get-test",
          verification: { type: "stripe", secret: SECRET },
        },
      }),
    );
    const created = await createRes.json<{ data: { id: string } }>();

    // GET — should be masked
    const getRes = await SELF.fetch(request(`/api/v1/sources/${created.data.id}`));
    const body = await getRes.json<{ data: { verification_secret: string } }>();
    expect(body.data.verification_secret).toBe("****2345");
    expect(body.data.verification_secret).not.toBe(SECRET);
  });

  it("GET /sources (list) returns masked secrets", async () => {
    await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "stripe-list-test",
          verification: { type: "stripe", secret: SECRET },
        },
      }),
    );

    const listRes = await SELF.fetch(request("/api/v1/sources"));
    const body = await listRes.json<{ data: { verification_secret: string }[] }>();
    expect(body.data.length).toBeGreaterThan(0);
    for (const source of body.data) {
      if (source.verification_secret) {
        expect(source.verification_secret).toMatch(/^\*{4}/);
        expect(source.verification_secret).not.toBe(SECRET);
      }
    }
  });

  it("PUT /sources/:id returns masked secret", async () => {
    const createRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "stripe-put-test",
          verification: { type: "stripe", secret: SECRET },
        },
      }),
    );
    const created = await createRes.json<{ data: { id: string } }>();

    // Update name
    const putRes = await SELF.fetch(
      request(`/api/v1/sources/${created.data.id}`, {
        method: "PUT",
        body: { name: "stripe-updated" },
      }),
    );
    const body = await putRes.json<{ data: { verification_secret: string; name: string } }>();
    expect(body.data.name).toBe("stripe-updated");
    expect(body.data.verification_secret).toBe("****2345");
  });

  it("source without verification returns null secret", async () => {
    const createRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: "no-verify-test" },
      }),
    );
    const created = await createRes.json<{ data: { id: string } }>();

    const getRes = await SELF.fetch(request(`/api/v1/sources/${created.data.id}`));
    const body = await getRes.json<{ data: { verification_secret: string | null } }>();
    expect(body.data.verification_secret).toBe(null);
  });
});

describe("Export retains full secrets for migration", () => {
  it("GET /export includes unmasked verification_secret", async () => {
    const SECRET = "whsec_export_full_secret_99";

    await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: {
          name: "stripe-export-test",
          verification: { type: "stripe", secret: SECRET },
        },
      }),
    );

    const exportRes = await SELF.fetch(request("/api/v1/export"));
    const body = await exportRes.json<{ data: ExportData }>();
    const exportedSource = body.data.sources.find((s) => s.name === "stripe-export-test");

    expect(exportedSource).toBeTruthy();
    expect(exportedSource!.verification_secret).toBe(SECRET);
    expect(exportedSource!.verification_secret).not.toMatch(/^\*{4}/);
  });
});
