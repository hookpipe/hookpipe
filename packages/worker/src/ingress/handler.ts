import type { Context } from "hono";
import type { Env, QueueMessage } from "../lib/types";
import { generateId } from "../lib/id";
import { createDb, getSource } from "../db/queries";
import { ApiError } from "../lib/errors";
import {
  createSourceVerifier,
  parseEventType,
  handleChallenge,
} from "../providers/registry";

const MAX_PAYLOAD_BYTES = 256 * 1024;

// In-memory source cache (per-isolate, reset on cold start)
const sourceCache = new Map<string, { data: Awaited<ReturnType<typeof getSource>>; cachedAt: number }>();
const SOURCE_CACHE_TTL_MS = 60_000; // 1 minute

/**
 * POST /webhooks/:source_id
 *
 * Critical path — 4 blocking I/O operations:
 * 1. Source lookup (cached in memory)
 * 2. Idempotency check (KV read)
 * 3. R2 payload archive (decouples payload size from queue message limit)
 * 4. Queue send (+ KV write in parallel)
 *
 * D1 event record is deferred to the queue consumer.
 */
export async function handleWebhookIngress(c: Context<{ Bindings: Env }>) {
  const sourceId = c.req.param("source_id")!;
  const env = c.env;

  // 1. Source lookup (cached — avoids D1 read on every request)
  const source = await getCachedSource(env, sourceId);
  if (!source) {
    throw new ApiError(404, `Source not found: ${sourceId}`, "SOURCE_NOT_FOUND");
  }

  // Payload size check (before reading body)
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

  // 3. Verify signature (powered by @hookpipe/providers)
  const verifier = createSourceVerifier(source);
  if (verifier) {
    const reqHeaders: Record<string, string> = {};
    c.req.raw.headers.forEach((value, key) => {
      reqHeaders[key] = value;
    });

    const valid = await verifier(body, reqHeaders);
    if (!valid) {
      throw new ApiError(401, "Invalid webhook signature", "INVALID_SIGNATURE");
    }
  }

  // 4. Idempotency check (KV read — fast)
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

  // 5. Parse event type
  const headers: Record<string, string> = {};
  for (const key of ["content-type", "user-agent", "x-request-id", "x-webhook-id", "x-github-event", "x-shopify-topic"]) {
    const val = c.req.header(key);
    if (val) headers[key] = val;
  }
  const eventType = parseEventType(provider, body, headers);

  // 6. Archive payload to R2 (decouples payload size from 128KB queue message limit)
  const eventId = generateId("evt");
  const r2Key = `${sourceId}/${eventId}`;
  await env.PAYLOAD_BUCKET.put(r2Key, body, {
    httpMetadata: { contentType: headers["content-type"] ?? "application/octet-stream" },
  });

  // 7. Enqueue — queue message carries only metadata + R2 key (no raw payload)
  const queueMessage: QueueMessage = {
    eventId,
    sourceId,
    eventType,
    payloadR2Key: r2Key,
    headers,
    idempotencyKey: idempotencyKey ?? null,
    receivedAt: new Date().toISOString(),
  };

  // Queue send + idempotency KV write in parallel
  const promises: Promise<unknown>[] = [
    env.WEBHOOK_QUEUE.send(queueMessage),
  ];
  if (idempotencyKey) {
    const ttl = parseInt(env.IDEMPOTENCY_TTL_S, 10) || 86400;
    promises.push(
      env.IDEMPOTENCY_KV.put(`idem:${sourceId}:${idempotencyKey}`, eventId, { expirationTtl: ttl }),
    );
  }
  await Promise.all(promises);

  return c.json({ message: "Accepted", event_id: eventId }, 202);
}

/**
 * Source lookup with in-memory cache.
 * Falls back to D1 on cache miss. TTL: 1 minute.
 */
async function getCachedSource(env: Env, sourceId: string) {
  const now = Date.now();
  const cached = sourceCache.get(sourceId);
  if (cached && (now - cached.cachedAt) < SOURCE_CACHE_TTL_MS) {
    return cached.data;
  }

  const db = createDb(env.DB);
  const source = await getSource(db, sourceId);
  sourceCache.set(sourceId, { data: source, cachedAt: now });
  return source;
}
