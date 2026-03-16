import type { Context } from "hono";
import type { Env, QueueMessage } from "../lib/types";
import { generateId } from "../lib/id";
import { createDb, getSource, createEvent } from "../db/queries";
import { verifyWebhookSignature } from "../lib/crypto";
import type { VerificationType } from "../lib/crypto";
import { ApiError } from "../lib/errors";
import {
  resolveSignatureHeader,
  resolveVerificationType,
  parseEventType,
  handleChallenge,
} from "../providers/registry";

/**
 * POST /webhooks/:source_id
 *
 * 1. Look up source in D1
 * 2. Handle challenge (Slack url_verification, etc.)
 * 3. Verify signature (provider-aware or legacy)
 * 4. Check idempotency (KV)
 * 5. Parse event type (provider-aware or fallback)
 * 6. Archive payload (R2)
 * 7. Record event (D1)
 * 8. Enqueue for delivery (Queue)
 * 9. Return 202 Accepted
 */
export async function handleWebhookIngress(c: Context<{ Bindings: Env }>) {
  const sourceId = c.req.param("source_id")!;
  const env = c.env;
  const db = createDb(env.DB);

  // 1. Look up source
  const source = await getSource(db, sourceId);
  if (!source) {
    throw new ApiError(404, `Source not found: ${sourceId}`, "SOURCE_NOT_FOUND");
  }

  // Payload size limit (default 256KB)
  const MAX_PAYLOAD_BYTES = 256 * 1024;
  const contentLength = parseInt(c.req.header("content-length") ?? "0", 10);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    throw new ApiError(413, `Payload too large: ${contentLength} bytes (max ${MAX_PAYLOAD_BYTES})`, "PAYLOAD_TOO_LARGE");
  }

  // Read raw body
  const body = await c.req.text();
  if (body.length > MAX_PAYLOAD_BYTES) {
    throw new ApiError(413, `Payload too large: ${body.length} bytes (max ${MAX_PAYLOAD_BYTES})`, "PAYLOAD_TOO_LARGE");
  }
  const provider = source.provider ?? null;

  // 2. Handle challenge (e.g. Slack url_verification)
  const challengeResponse = handleChallenge(provider, body);
  if (challengeResponse !== null) {
    return c.json(challengeResponse, 200);
  }

  // 3. Verify signature (provider-aware)
  if (source.verification_type || source.verification_secret) {
    const signatureHeader = resolveSignatureHeader(
      provider,
      source.verification_type,
      c.req.header.bind(c.req),
    );

    if (!signatureHeader) {
      throw new ApiError(401, "Missing webhook signature", "MISSING_SIGNATURE");
    }

    const vType = resolveVerificationType(provider, source.verification_type);
    const valid = await verifyWebhookSignature(
      (vType ?? "hmac-sha256") as VerificationType,
      source.verification_secret!,
      body,
      signatureHeader,
    );

    if (!valid) {
      throw new ApiError(401, "Invalid webhook signature", "INVALID_SIGNATURE");
    }
  }

  // 4. Check idempotency
  const idempotencyKey =
    c.req.header("x-idempotency-key") ??
    c.req.header("x-request-id") ??
    c.req.header("x-webhook-id");

  if (idempotencyKey) {
    const kvKey = `idem:${sourceId}:${idempotencyKey}`;
    const existing = await env.IDEMPOTENCY_KV.get(kvKey);
    if (existing) {
      return c.json({ message: "Duplicate event ignored", event_id: existing }, 200);
    }
  }

  // 5. Parse event type (provider-aware)
  const headers: Record<string, string> = {};
  for (const key of ["content-type", "user-agent", "x-request-id", "x-webhook-id", "x-github-event", "x-shopify-topic"]) {
    const val = c.req.header(key);
    if (val) headers[key] = val;
  }

  const eventType = parseEventType(provider, body, headers);

  // 6. Archive payload to R2
  const eventId = generateId("evt");
  const r2Key = `${sourceId}/${eventId}`;
  await env.PAYLOAD_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
  });

  // 7. Record event in D1
  await createEvent(db, {
    id: eventId,
    source_id: sourceId,
    event_type: eventType,
    idempotency_key: idempotencyKey ?? null,
    payload_r2_key: r2Key,
    headers: JSON.stringify(headers),
  });

  // 8. Store idempotency key
  if (idempotencyKey) {
    const ttl = parseInt(env.IDEMPOTENCY_TTL_S, 10) || 86400;
    await env.IDEMPOTENCY_KV.put(`idem:${sourceId}:${idempotencyKey}`, eventId, {
      expirationTtl: ttl,
    });
  }

  // 9. Enqueue for delivery
  const queueMessage: QueueMessage = {
    eventId,
    sourceId,
    eventType,
    payloadR2Key: r2Key,
    headers,
    receivedAt: new Date().toISOString(),
  };

  await env.WEBHOOK_QUEUE.send(queueMessage);

  return c.json({ message: "Accepted", event_id: eventId }, 202);
}
