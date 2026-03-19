/**
 * Generic HMAC webhook signature verification.
 * Handles hex (GitHub, Vercel) and base64 (Shopify) encodings.
 * Strips common prefixes: sha256=, sha1=, v1=
 */

import { computeHmac, timingSafeEqual } from "./util";

export async function verifyHmacSignature(
  algorithm: "SHA-256" | "SHA-1",
  secret: string,
  payload: string,
  signature: string,
  encoding: "hex" | "base64" = "hex",
): Promise<boolean> {
  const expected = await computeHmac(algorithm, secret, payload, encoding);

  // Strip common prefixes
  const rawSignature = signature.replace(/^(sha256|sha1|v1)=/, "");

  return timingSafeEqual(expected, rawSignature);
}
