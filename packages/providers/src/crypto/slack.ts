/**
 * Slack webhook signature verification.
 *
 * Signature header (x-slack-signature): v0=<hex_hmac>
 * Timestamp header (x-slack-request-timestamp): Unix epoch seconds
 * Signed payload: "v0:{timestamp}:{body}"
 * Algorithm: HMAC-SHA256
 */

import { computeHmac, timingSafeEqual } from "./util";

export async function verifySlackSignature(
  secret: string,
  payload: string,
  signatureHeader: string,
  timestampHeader: string,
  toleranceSec: number = 300,
): Promise<boolean> {
  // Validate timestamp
  const timestamp = parseInt(timestampHeader, 10);
  if (isNaN(timestamp)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  // Strip v0= prefix
  const signature = signatureHeader.startsWith("v0=")
    ? signatureHeader.slice(3)
    : signatureHeader;

  // Compute expected: HMAC-SHA256("v0:{timestamp}:{body}")
  const sigBaseString = `v0:${timestamp}:${payload}`;
  const expected = await computeHmac("SHA-256", secret, sigBaseString);

  return timingSafeEqual(expected, signature);
}
