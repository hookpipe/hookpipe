/**
 * Mask a secret string, showing only the last 4 characters.
 * Returns null if input is null/undefined.
 *
 * Examples:
 *   "whsec_live_abc123xyz" → "****xyz"
 *   "short" → "****ort"
 *   "ab" → "****"
 *   null → null
 */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null;
  if (secret.length <= 4) return "****";
  return "****" + secret.slice(-4);
}

/**
 * Mask the verification_secret field on a source object.
 * Returns a new object (does not mutate).
 */
export function maskSourceSecret<T extends { verification_secret: string | null }>(
  source: T,
): T {
  return { ...source, verification_secret: maskSecret(source.verification_secret) };
}
