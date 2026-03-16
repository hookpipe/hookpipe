import { describe, it, expect, beforeEach } from "vitest";
import { SELF } from "cloudflare:test";
import { migrateDb, request, bootstrap } from "./helpers";
import { validateDestinationUrl } from "../src/lib/url-validation";

beforeEach(async () => {
  await migrateDb();
  await bootstrap();
});

describe("SSRF protection — URL validation", () => {
  it("allows valid HTTPS URLs", () => {
    expect(validateDestinationUrl("https://api.example.com/hooks")).toBe(null);
    expect(validateDestinationUrl("https://myapp.vercel.app/api/webhooks")).toBe(null);
  });

  it("blocks HTTP URLs by default", () => {
    const err = validateDestinationUrl("http://api.example.com/hooks");
    expect(err).toContain("HTTPS");
  });

  it("allows HTTP when explicitly opted in", () => {
    expect(validateDestinationUrl("http://api.example.com/hooks", { allowHttp: true })).toBe(null);
  });

  it("blocks localhost", () => {
    expect(validateDestinationUrl("https://localhost/hooks")).toContain("Blocked");
    expect(validateDestinationUrl("https://localhost:8787/hooks")).toContain("Blocked");
  });

  it("blocks 127.0.0.1 (loopback)", () => {
    expect(validateDestinationUrl("https://127.0.0.1/hooks")).toContain("Blocked");
    expect(validateDestinationUrl("https://127.0.0.99/hooks")).toContain("Blocked");
  });

  it("blocks 10.x.x.x (private)", () => {
    expect(validateDestinationUrl("https://10.0.0.1/hooks")).toContain("Blocked");
    expect(validateDestinationUrl("https://10.255.255.255/hooks")).toContain("Blocked");
  });

  it("blocks 172.16-31.x.x (private)", () => {
    expect(validateDestinationUrl("https://172.16.0.1/hooks")).toContain("Blocked");
    expect(validateDestinationUrl("https://172.31.255.255/hooks")).toContain("Blocked");
  });

  it("allows 172.32.x.x (not private)", () => {
    expect(validateDestinationUrl("https://172.32.0.1/hooks")).toBe(null);
  });

  it("blocks 192.168.x.x (private)", () => {
    expect(validateDestinationUrl("https://192.168.1.1/hooks")).toContain("Blocked");
  });

  it("blocks 169.254.x.x (link-local / AWS metadata)", () => {
    expect(validateDestinationUrl("https://169.254.169.254/latest/meta-data/")).toContain("Blocked");
  });

  it("blocks 0.0.0.0", () => {
    expect(validateDestinationUrl("https://0.0.0.0/hooks")).toContain("Blocked");
  });

  it("blocks metadata.google.internal", () => {
    expect(validateDestinationUrl("https://metadata.google.internal/")).toContain("Blocked");
  });

  it("blocks non-HTTP protocols", () => {
    expect(validateDestinationUrl("ftp://example.com/hooks")).toContain("Unsupported protocol");
    expect(validateDestinationUrl("file:///etc/passwd")).toContain("Unsupported protocol");
  });
});

describe("SSRF — destination API integration", () => {
  it("rejects destination with private IP", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "ssrf", url: "https://192.168.1.1/hooks" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects destination with localhost", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "local", url: "https://localhost:8787/api" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects destination with HTTP", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "insecure", url: "http://api.example.com/hooks" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts valid HTTPS destination", async () => {
    const res = await SELF.fetch(
      request("/api/v1/destinations", {
        method: "POST",
        body: { name: "valid", url: "https://api.example.com/hooks" },
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Payload size limit", () => {
  it("accepts normal-sized webhook payload", async () => {
    // Create a source first
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: `payload-test-${Date.now()}` },
      }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    const res = await SELF.fetch(
      request(`/webhooks/${src.data.id}`, {
        method: "POST",
        body: { type: "test", data: { small: true } },
      }),
    );
    expect(res.status).toBe(202);
  });

  it("rejects oversized payload via content-length", async () => {
    const srcRes = await SELF.fetch(
      request("/api/v1/sources", {
        method: "POST",
        body: { name: `oversize-test-${Date.now()}` },
      }),
    );
    const src = await srcRes.json<{ data: { id: string } }>();

    const res = await SELF.fetch(
      new Request(`http://localhost/webhooks/${src.data.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "999999999",
        },
        body: JSON.stringify({ tiny: true }),
      }),
    );
    expect(res.status).toBe(413);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
