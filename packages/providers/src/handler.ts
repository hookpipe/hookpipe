/**
 * createHandler — full webhook handling: verify + parse + validate.
 *
 * ```typescript
 * import { stripe, createHandler } from '@hookpipe/providers';
 * const webhook = createHandler(stripe, { secret: 'whsec_xxx' });
 *
 * app.post('/webhook', async (req, res) => {
 *   const result = await webhook.handle(req.body, req.headers);
 *   if (!result.verified) return res.status(401).end();
 *   console.log(result.eventType, result.payload);
 * });
 * ```
 */

import type { Provider, EventDefinition } from "./define";
import { createVerifier, type VerifierOptions } from "./verifier";

export interface HandlerResult {
  /** Whether signature verification passed */
  verified: boolean;
  /** Whether this is a challenge request (e.g. Slack url_verification) */
  isChallenge: boolean;
  /** Challenge response body (only when isChallenge is true) */
  challengeResponse?: unknown;
  /** Extracted event type (null if provider has no parseEventType) */
  eventType: string | null;
  /** Extracted event ID (null if provider has no parseEventId) */
  eventId: string | null;
  /** Parsed payload (decoded if provider has decode, otherwise JSON.parse) */
  payload: unknown;
}

export interface Handler {
  /** Process a webhook request: verify signature, parse event, extract metadata. */
  handle(body: string, headers: Record<string, string>): Promise<HandlerResult>;
}

/**
 * Create a full webhook handler from a provider definition and secrets.
 */
export function createHandler(
  provider: Provider,
  secrets: Record<string, string>,
  opts?: VerifierOptions,
): Handler {
  const verify = createVerifier(provider, secrets, opts);

  return {
    async handle(body, headers) {
      // 1. Parse body
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return {
          verified: false,
          isChallenge: false,
          eventType: null,
          eventId: null,
          payload: null,
        };
      }

      // 2. Challenge detection (before verification — Slack sends challenges immediately)
      if (provider.challenge) {
        const parsed = payload as Record<string, unknown>;
        if (provider.challenge.detect(parsed)) {
          return {
            verified: true,
            isChallenge: true,
            challengeResponse: provider.challenge.respond(parsed),
            eventType: null,
            eventId: null,
            payload,
          };
        }
      }

      // 3. Verify signature
      const verified = await verify(body, headers);

      // 4. Decode (if provider has decode capability)
      if (provider.decode && verified) {
        try {
          payload = await provider.decode(secrets, body, headers);
        } catch {
          // decode failed — keep original payload
        }
      }

      // 5. Extract event type and ID
      const eventType = provider.parseEventType?.(payload, headers) ?? null;
      const eventId = provider.parseEventId?.(payload, headers) ?? null;

      return {
        verified,
        isChallenge: false,
        eventType,
        eventId,
        payload,
      };
    },
  };
}
