import type { Env, QueueMessage, DeliveryTask } from "../lib/types";
import { generateId } from "../lib/id";
import { getSubscriptionsBySource } from "../db/queries";
import { getDestination, createDelivery } from "../db/queries";

/**
 * Queue consumer: reads webhook events from the queue,
 * resolves subscriptions, and dispatches delivery tasks
 * to the Durable Object for each destination.
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
  // Find all active subscriptions for this source
  const subscriptions = await getSubscriptionsBySource(env.DB, msg.sourceId);

  for (const sub of subscriptions) {
    // Check event type filter
    if (!matchesEventType(msg.eventType, sub.event_types)) {
      continue;
    }

    // Look up destination
    const dest = await getDestination(env.DB, sub.destination_id);
    if (!dest) continue;

    // Create delivery record
    const deliveryId = generateId("dlv");
    await createDelivery(env.DB, {
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
      backoffBaseMs: dest.backoff_base_ms,
      backoffMaxMs: dest.backoff_max_ms,
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
    if (!eventType) return true; // No type means accept all
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
