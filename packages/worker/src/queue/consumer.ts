import type { Env, QueueMessage, DeliveryTask } from "../lib/types";
import { generateId } from "../lib/id";
import { createDb, getSubscriptionsBySource, getDestination, createDelivery, createEvent } from "../db/queries";

/**
 * Queue consumer: processes ingested webhook events.
 *
 * Payload is already archived to R2 by ingress. This consumer:
 * 1. Records the event in D1
 * 2. Resolves subscriptions and dispatches to Delivery DOs
 */

export async function handleQueueBatch(
  batch: MessageBatch<QueueMessage>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processMessage(message.body, env);
      message.ack();
    } catch (err) {
      console.error(`Failed to process event ${message.body.eventId}:`, err);
      message.retry();
    }
  }
}

async function processMessage(msg: QueueMessage, env: Env): Promise<void> {
  const db = createDb(env.DB);

  // 1. Record event in D1 (payload already archived to R2 by ingress)
  await createEvent(db, {
    id: msg.eventId,
    source_id: msg.sourceId,
    event_type: msg.eventType,
    idempotency_key: msg.idempotencyKey,
    payload_r2_key: msg.payloadR2Key,
    headers: JSON.stringify(msg.headers),
  });

  // 2. Find all active subscriptions for this source
  const subscriptions = await getSubscriptionsBySource(db, msg.sourceId);

  for (const sub of subscriptions) {
    // Check event type filter
    if (!matchesEventType(msg.eventType, sub.event_types)) {
      continue;
    }

    // Look up destination
    const dest = await getDestination(db, sub.destination_id);
    if (!dest) continue;

    // Create delivery record
    const deliveryId = generateId("dlv");
    await createDelivery(db, {
      id: deliveryId,
      event_id: msg.eventId,
      destination_id: dest.id,
    });

    // Dispatch to Durable Object
    const task: DeliveryTask = {
      deliveryId,
      eventId: msg.eventId,
      destinationId: dest.id,
      destinationUrl: dest.url,
      payloadR2Key: msg.payloadR2Key,
      headers: msg.headers,
      attempt: 1,
      maxRetries: dest.max_retries,
      timeoutMs: dest.timeout_ms,
      retryStrategy: (dest as Record<string, unknown>).retry_strategy as DeliveryTask["retryStrategy"] ?? "exponential",
      retryIntervalMs: (dest as Record<string, unknown>).retry_interval_ms as number ?? 60000,
      retryMaxIntervalMs: (dest as Record<string, unknown>).retry_max_interval_ms as number ?? 86400000,
      retryOnStatus: (dest as Record<string, unknown>).retry_on_status as string ?? null,
    };

    const doId = env.DELIVERY_DO.idFromName(dest.id);
    const doStub = env.DELIVERY_DO.get(doId);

    await doStub.fetch("https://do/deliver", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(task),
    });
  }
}

function matchesEventType(eventType: string | null, filterJson: string): boolean {
  try {
    const filters: string[] = JSON.parse(filterJson);
    if (filters.includes("*")) return true;
    if (!eventType) return true;
    return filters.some((f) => {
      if (f.endsWith(".*")) {
        return eventType.startsWith(f.slice(0, -1));
      }
      return f === eventType;
    });
  } catch {
    return true;
  }
}
