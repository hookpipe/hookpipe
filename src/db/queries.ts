import type {
  Source,
  Destination,
  Subscription,
  Event,
  Delivery,
} from "../lib/types";

// --- Sources ---

export async function getSource(
  db: D1Database,
  id: string,
): Promise<Source | null> {
  return db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id)
    .first<Source>();
}

export async function listSources(db: D1Database): Promise<Source[]> {
  const result = await db.prepare("SELECT * FROM sources ORDER BY created_at DESC").all<Source>();
  return result.results;
}

export async function createSource(
  db: D1Database,
  source: Pick<Source, "id" | "name" | "verification_type" | "verification_secret">,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO sources (id, name, verification_type, verification_secret) VALUES (?, ?, ?, ?)",
    )
    .bind(source.id, source.name, source.verification_type, source.verification_secret)
    .run();
}

export async function updateSource(
  db: D1Database,
  id: string,
  fields: Partial<Pick<Source, "name" | "verification_type" | "verification_secret">>,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | null)[] = [];

  if (fields.name !== undefined) {
    sets.push("name = ?");
    values.push(fields.name);
  }
  if (fields.verification_type !== undefined) {
    sets.push("verification_type = ?");
    values.push(fields.verification_type);
  }
  if (fields.verification_secret !== undefined) {
    sets.push("verification_secret = ?");
    values.push(fields.verification_secret);
  }

  if (sets.length === 0) return;

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  await db
    .prepare(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

export async function deleteSource(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM sources WHERE id = ?").bind(id).run();
}

// --- Destinations ---

export async function getDestination(
  db: D1Database,
  id: string,
): Promise<Destination | null> {
  return db
    .prepare("SELECT * FROM destinations WHERE id = ?")
    .bind(id)
    .first<Destination>();
}

export async function listDestinations(db: D1Database): Promise<Destination[]> {
  const result = await db
    .prepare("SELECT * FROM destinations ORDER BY created_at DESC")
    .all<Destination>();
  return result.results;
}

export async function createDestination(
  db: D1Database,
  dest: Pick<
    Destination,
    "id" | "name" | "url" | "timeout_ms" | "max_retries" | "backoff_base_ms" | "backoff_max_ms"
  >,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO destinations (id, name, url, timeout_ms, max_retries, backoff_base_ms, backoff_max_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      dest.id, dest.name, dest.url,
      dest.timeout_ms, dest.max_retries, dest.backoff_base_ms, dest.backoff_max_ms,
    )
    .run();
}

export async function updateDestination(
  db: D1Database,
  id: string,
  fields: Partial<
    Pick<Destination, "name" | "url" | "timeout_ms" | "max_retries" | "backoff_base_ms" | "backoff_max_ms">
  >,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value as string | number);
    }
  }

  if (sets.length === 0) return;

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  await db
    .prepare(`UPDATE destinations SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

export async function deleteDestination(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM destinations WHERE id = ?").bind(id).run();
}

// --- Subscriptions ---

export async function getSubscription(
  db: D1Database,
  id: string,
): Promise<Subscription | null> {
  return db
    .prepare("SELECT * FROM subscriptions WHERE id = ?")
    .bind(id)
    .first<Subscription>();
}

export async function listSubscriptions(db: D1Database): Promise<Subscription[]> {
  const result = await db
    .prepare("SELECT * FROM subscriptions ORDER BY created_at DESC")
    .all<Subscription>();
  return result.results;
}

export async function getSubscriptionsBySource(
  db: D1Database,
  sourceId: string,
): Promise<Subscription[]> {
  const result = await db
    .prepare("SELECT * FROM subscriptions WHERE source_id = ? AND enabled = 1")
    .bind(sourceId)
    .all<Subscription>();
  return result.results;
}

export async function createSubscription(
  db: D1Database,
  sub: Pick<Subscription, "id" | "source_id" | "destination_id" | "event_types">,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO subscriptions (id, source_id, destination_id, event_types) VALUES (?, ?, ?, ?)",
    )
    .bind(sub.id, sub.source_id, sub.destination_id, sub.event_types)
    .run();
}

export async function deleteSubscription(db: D1Database, id: string): Promise<void> {
  await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
}

// --- Events ---

export async function createEvent(
  db: D1Database,
  event: Pick<Event, "id" | "source_id" | "event_type" | "idempotency_key" | "payload_r2_key" | "headers">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, source_id, event_type, idempotency_key, payload_r2_key, headers)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      event.id, event.source_id, event.event_type,
      event.idempotency_key, event.payload_r2_key, event.headers,
    )
    .run();
}

export async function getEvent(db: D1Database, id: string): Promise<Event | null> {
  return db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first<Event>();
}

export async function listEvents(
  db: D1Database,
  opts: { sourceId?: string; limit?: number; offset?: number } = {},
): Promise<Event[]> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  if (opts.sourceId) {
    const result = await db
      .prepare(
        "SELECT * FROM events WHERE source_id = ? ORDER BY received_at DESC LIMIT ? OFFSET ?",
      )
      .bind(opts.sourceId, limit, offset)
      .all<Event>();
    return result.results;
  }

  const result = await db
    .prepare("SELECT * FROM events ORDER BY received_at DESC LIMIT ? OFFSET ?")
    .bind(limit, offset)
    .all<Event>();
  return result.results;
}

// --- Deliveries ---

export async function createDelivery(
  db: D1Database,
  delivery: Pick<Delivery, "id" | "event_id" | "destination_id">,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO deliveries (id, event_id, destination_id) VALUES (?, ?, ?)",
    )
    .bind(delivery.id, delivery.event_id, delivery.destination_id)
    .run();
}

export async function updateDelivery(
  db: D1Database,
  id: string,
  fields: Partial<Pick<Delivery, "status" | "attempt" | "status_code" | "latency_ms" | "response_body" | "next_retry_at">>,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      sets.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }

  if (sets.length === 0) return;

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')");
  await db
    .prepare(`UPDATE deliveries SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, id)
    .run();
}

export async function getDeliveriesByEvent(
  db: D1Database,
  eventId: string,
): Promise<Delivery[]> {
  const result = await db
    .prepare("SELECT * FROM deliveries WHERE event_id = ? ORDER BY created_at ASC")
    .bind(eventId)
    .all<Delivery>();
  return result.results;
}
