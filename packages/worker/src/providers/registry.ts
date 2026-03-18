/**
 * Provider registry.
 *
 * Maps provider IDs to their definitions. Used by the ingress handler
 * to resolve verification config, event parsing, and challenge handling.
 *
 * Built-in providers are imported at build time. The registry can be
 * extended at runtime for testing or custom providers.
 */

import { builtinProviders, type Provider, type VerificationConfig } from "@hookpipe/providers";

const registry = new Map<string, Provider>();

// Register all built-in providers
for (const [id, provider] of Object.entries(builtinProviders)) {
  registry.set(id, provider);
}

export function getProvider(id: string): Provider | undefined {
  return registry.get(id);
}

export function listProviders(): Provider[] {
  return [...registry.values()];
}

export function hasProvider(id: string): boolean {
  return registry.has(id);
}

/**
 * Resolve the signature header name for a provider or verification type.
 *
 * Priority:
 * 1. If source has a provider → use provider's verification.header
 * 2. If source has a verification_type → use legacy mapping
 * 3. Fall back to common webhook signature headers
 */
export function resolveSignatureHeader(
  provider: string | null,
  verificationType: string | null,
  getHeader: (name: string) => string | undefined,
): string | null {
  // 1. Provider-based resolution
  if (provider) {
    const p = getProvider(provider);
    if (p) {
      const header = getVerificationHeader(p.verification);
      if (header) return getHeader(header) ?? null;
    }
  }

  // 2. Legacy verification_type resolution
  switch (verificationType) {
    case "stripe":
      return getHeader("stripe-signature") ?? null;
    case "slack":
      return getHeader("x-slack-signature") ?? null;
    case "hmac-sha256":
      return getHeader("x-hub-signature-256") ?? getHeader("x-webhook-signature") ?? null;
    case "hmac-sha1":
      return getHeader("x-hub-signature") ?? null;
    default:
      return getHeader("x-webhook-signature") ?? getHeader("x-hub-signature-256") ?? null;
  }
}

/**
 * Resolve the verification type for a source, preferring provider config.
 */
export function resolveVerificationType(
  provider: string | null,
  verificationType: string | null,
): string | null {
  if (provider) {
    const p = getProvider(provider);
    if (p) {
      const v = p.verification;
      if ("type" in v) return v.type;
      return v.algorithm;
    }
  }
  return verificationType;
}

/**
 * Extract event type from payload using provider's parseEventType,
 * or fall back to common field names.
 */
export function parseEventType(
  provider: string | null,
  body: string,
  headers: Record<string, string>,
): string | null {
  if (provider) {
    const p = getProvider(provider);
    if (p?.parseEventType) {
      try {
        const parsed = JSON.parse(body);
        return p.parseEventType(parsed, headers) ?? null;
      } catch {
        return null;
      }
    }
  }

  // Fallback: common event type fields
  try {
    const parsed = JSON.parse(body);
    const eventType = parsed.type ?? parsed.event ?? parsed.event_type ?? null;
    return typeof eventType === "string" ? eventType : null;
  } catch {
    return null;
  }
}

/**
 * Check if a request is a challenge/verification request (e.g. Slack url_verification).
 * Returns the response body if it is, null otherwise.
 */
export function handleChallenge(
  provider: string | null,
  body: string,
): unknown | null {
  if (!provider) return null;
  const p = getProvider(provider);
  if (!p?.challenge) return null;

  try {
    const parsed = JSON.parse(body);
    if (p.challenge.detect(parsed)) {
      return p.challenge.respond(parsed);
    }
  } catch {
    // Not JSON or detect failed
  }
  return null;
}

function getVerificationHeader(v: VerificationConfig): string | null {
  if ("header" in v) return v.header;
  return null;
}
