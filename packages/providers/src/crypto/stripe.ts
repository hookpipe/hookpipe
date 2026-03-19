/**
 * Stripe webhook signature verification.
 *
 * Header format: t=1492774577,v1=5257a869...,v1=...
 * Signed payload: "${timestamp}.${body}"
 * Algorithm: HMAC-SHA256
 */

import { computeHmac, timingSafeEqual } from "./util";

export async function verifyStripeSignature(
  secret: string,
  payload: string,
  header: string,
  toleranceSec: number = 300,
): Promise<boolean> {
  const parts = header.split(",");

  // Extract timestamp
  const tPart = parts.find((p) => p.startsWith("t="));
  if (!tPart) return false;
  const timestamp = parseInt(tPart.slice(2), 10);
  if (isNaN(timestamp)) return false;

  // Check timestamp tolerance (prevent replay attacks)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  // Extract v1 signatures (Stripe may include multiple)
  const signatures = parts
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));
  if (signatures.length === 0) return false;

  // Compute expected: HMAC-SHA256("${timestamp}.${payload}")
  const signedPayload = `${timestamp}.${payload}`;
  const expected = await computeHmac("SHA-256", secret, signedPayload);

  return signatures.some((sig) => timingSafeEqual(expected, sig));
}
