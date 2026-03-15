import { describe, it, expect } from "vitest";
import { verifyHmacSignature } from "../src/lib/crypto";

describe("verifyHmacSignature", () => {
  it("verifies valid HMAC-SHA256 signature", async () => {
    const secret = "test-secret";
    const payload = '{"event":"test"}';

    // Generate expected signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const signature = [...new Uint8Array(signed)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifyHmacSignature("hmac-sha256", secret, payload, signature);
    expect(result).toBe(true);
  });

  it("rejects invalid signature", async () => {
    const result = await verifyHmacSignature(
      "hmac-sha256",
      "secret",
      "payload",
      "0000000000000000000000000000000000000000000000000000000000000000",
    );
    expect(result).toBe(false);
  });

  it("handles sha256= prefix", async () => {
    const secret = "my-secret";
    const payload = "body";

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const hex = [...new Uint8Array(signed)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifyHmacSignature("hmac-sha256", secret, payload, `sha256=${hex}`);
    expect(result).toBe(true);
  });
});
