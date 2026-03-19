/**
 * Provider registry.
 *
 * Maps provider IDs to their definitions. Used by the ingress handler
 * to resolve verification, event parsing, and challenge handling.
 *
 * Built-in providers are imported at build time. The registry can be
 * extended at runtime for testing or custom providers.
 */

import {
  builtinProviders,
  defineProvider,
  createVerifier,
  type Provider,
  type VerifyFn,
} from "@hookpipe/providers";

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
 * Create a verifier for a source, using @hookpipe/providers as the verification engine.
 *
 * - Provider-based sources: uses the provider's verification config directly.
 * - Legacy sources (no provider): builds a minimal anonymous provider from verification_type.
 *
 * Returns null if the source has no verification configured.
 */
export function createSourceVerifier(source: {
  provider: string | null;
  verification_type: string | null;
  verification_secret: string | null;
}): VerifyFn | null {
  if (!source.verification_secret) return null;

  // Provider-based source — use provider definition directly
  if (source.provider) {
    const p = getProvider(source.provider);
    if (p) return createVerifier(p, { secret: source.verification_secret });
  }

  // Legacy source (no provider) — build minimal anonymous provider
  const config = buildLegacyVerificationConfig(source.verification_type);
  const anon = defineProvider({
    id: "_legacy",
    name: "Legacy",
    verification: config,
    events: {},
  });
  return createVerifier(anon, { secret: source.verification_secret });
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

function buildLegacyVerificationConfig(type: string | null) {
  switch (type) {
    case "stripe":
      return { type: "stripe-signature" as const, header: "stripe-signature" };
    case "slack":
      return { type: "slack-signature" as const, header: "x-slack-signature" };
    case "hmac-sha1":
      return { header: "x-hub-signature", algorithm: "hmac-sha1" as const };
    case "hmac-sha256":
    default:
      return { header: "x-hub-signature-256", algorithm: "hmac-sha256" as const };
  }
}
