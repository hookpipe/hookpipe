/**
 * Verify HMAC signature of a webhook payload.
 */
export async function verifyHmacSignature(
  algorithm: string,
  secret: string,
  payload: string,
  signature: string,
): Promise<boolean> {
  const algo = normalizeAlgorithm(algorithm);
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: algo },
    false,
    ["sign"],
  );

  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected = hexEncode(signed);

  // Strip common prefixes like "sha256=" or "v1="
  const rawSignature = signature.replace(/^[a-z0-9]+=/, "");

  return timingSafeEqual(expected, rawSignature);
}

function normalizeAlgorithm(type: string): string {
  switch (type) {
    case "hmac-sha256":
      return "SHA-256";
    case "hmac-sha1":
      return "SHA-1";
    default:
      return "SHA-256";
  }
}

function hexEncode(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
