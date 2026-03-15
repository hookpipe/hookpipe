import type { Context } from "hono";
import type { Env, QueueMessage } from "../lib/types";
import { generateId } from "../lib/id";
import { getSource } from "../db/queries";
import { createEvent } from "../db/queries";
import { verifyHmacSignature } from "../lib/crypto";
import { ApiError } from "../lib/errors";

/**
 * POST /webhooks/:source_id
 *
 * 1. Look up source in D1
 * 2. Verify signature (if configured)
 * 3. Check idempotency (KV)
 * 4. Archive payload (R2)
 * 5. Record event (D1)
 * 6. Enqueue for delivery (Queue)
 * 7. Return 202 Accepted
 */
export async function handleWebhookIngress(c: Context<{ Bindings: Env }>) {
  const sourceId = c.req.param("source_id")!;
  const env = c.env;

  // 1. Look up source
  const source = await getSource(env.DB, sourceId);
  if (!source) {
    throw new ApiError(404, `Source not found: ${sourceId}`, "SOURCE_NOT_FOUND");
  }

  // Read raw body
  const body = await c.req.text();

  // 2. Verify signature if configured
  if (source.verification_type && source.verification_secret) {
    const signature =
      c.req.header("x-hub-signature-256") ??
      c.req.header("x-hub-signature") ??
      c.req.header("stripe-signature") ??
      c.req.header("x-webhook-signature") ??
      "";

    if (!signature) {
      throw new ApiError(401, "Missing webhook signature", "MISSING_SIGNATURE");
    }

    const valid = await verifyHmacSignature(
      source.verification_type,
      source.verification_secret,
      body,
      signature,
    );

    if (!valid) {
      throw new ApiError(401, "Invalid webhook signature", "INVALID_SIGNATURE");
    }
  }

  // 3. Check idempotency
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

  // Parse event type from body (best effort)
  let eventType: string | null = null;
  try {
    const parsed = JSON.parse(body);
    eventType = parsed.type ?? parsed.event ?? parsed.event_type ?? null;
    if (typeof eventType !== "string") eventType = null;
  } catch {
    // Not JSON — that's fine, we still accept it
  }

  // 4. Archive payload to R2
  const eventId = generateId("evt");
  const r2Key = `${sourceId}/${eventId}`;
  await env.PAYLOAD_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: c.req.header("content-type") ?? "application/octet-stream" },
  });

  // Capture relevant headers
  const headers: Record<string, string> = {};
  for (const key of ["content-type", "user-agent", "x-request-id", "x-webhook-id"]) {
    const val = c.req.header(key);
    if (val) headers[key] = val;
  }

  // 5. Record event in D1
  await createEvent(env.DB, {
    id: eventId,
    source_id: sourceId,
    event_type: eventType,
    idempotency_key: idempotencyKey ?? null,
    payload_r2_key: r2Key,
    headers: JSON.stringify(headers),
  });

  // 6. Store idempotency key
  if (idempotencyKey) {
    const ttl = parseInt(env.IDEMPOTENCY_TTL_S, 10) || 86400;
    await env.IDEMPOTENCY_KV.put(`idem:${sourceId}:${idempotencyKey}`, eventId, {
      expirationTtl: ttl,
    });
  }

  // 7. Enqueue for delivery
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
