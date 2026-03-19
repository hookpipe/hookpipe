import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { eq, desc, asc, and, sql } from "drizzle-orm";
import {
  sources,
  destinations,
  subscriptions,
  events,
  deliveries,
  consumers,
} from "./schema";

export type DB = DrizzleD1Database;

export function createDb(d1: D1Database): DB {
  return drizzle(d1);
}

// --- Sources ---

export async function getSource(db: DB, id: string) {
  return db.select().from(sources).where(eq(sources.id, id)).get();
}

export async function listSources(db: DB) {
  return db.select().from(sources).orderBy(desc(sources.created_at)).all();
}

export async function createSource(
  db: DB,
  source: typeof sources.$inferInsert,
) {
  await db.insert(sources).values(source).run();
}

export async function updateSource(
  db: DB,
  id: string,
  fields: Partial<
    Pick<typeof sources.$inferInsert, "name" | "provider" | "verification_type" | "verification_secret">
  >,
) {
  await db
    .update(sources)
    .set({ ...fields, updated_at: sql`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')` })
    .where(eq(sources.id, id))
    .run();
}

export async function deleteSource(db: DB, id: string) {
  await db.delete(sources).where(eq(sources.id, id)).run();
}

// --- Destinations ---

export async function getDestination(db: DB, id: string) {
  return db.select().from(destinations).where(eq(destinations.id, id)).get();
}

export async function listDestinations(db: DB) {
  return db
    .select()
    .from(destinations)
    .orderBy(desc(destinations.created_at))
    .all();
}

export async function createDestination(
  db: DB,
  dest: typeof destinations.$inferInsert,
) {
  await db.insert(destinations).values(dest).run();
}

export async function updateDestination(
  db: DB,
  id: string,
  fields: Partial<
    Pick<
      typeof destinations.$inferInsert,
      "name" | "url" | "timeout_ms" | "max_retries" | "retry_strategy" | "retry_interval_ms" | "retry_max_interval_ms" | "retry_on_status"
    >
  >,
) {
  await db
    .update(destinations)
    .set({
      ...fields,
      updated_at: sql`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    })
    .where(eq(destinations.id, id))
    .run();
}

export async function deleteDestination(db: DB, id: string) {
  await db.delete(destinations).where(eq(destinations.id, id)).run();
}

// --- Subscriptions ---

export async function getSubscription(db: DB, id: string) {
  return db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, id))
    .get();
}

export async function listSubscriptions(db: DB) {
  return db
    .select()
    .from(subscriptions)
    .orderBy(desc(subscriptions.created_at))
    .all();
}

export async function getSubscriptionsBySource(db: DB, sourceId: string) {
  return db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.source_id, sourceId),
        eq(subscriptions.enabled, 1),
      ),
    )
    .all();
}

export async function createSubscription(
  db: DB,
  sub: typeof subscriptions.$inferInsert,
) {
  await db.insert(subscriptions).values(sub).run();
}

export async function deleteSubscription(db: DB, id: string) {
  await db.delete(subscriptions).where(eq(subscriptions.id, id)).run();
}

// --- Events ---

export async function createEvent(
  db: DB,
  event: typeof events.$inferInsert,
) {
  await db.insert(events).values(event).run();
}

export async function getEvent(db: DB, id: string) {
  return db.select().from(events).where(eq(events.id, id)).get();
}

export async function listEvents(
  db: DB,
  opts: { sourceId?: string; after?: string; limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const conditions = [];
  if (opts.sourceId) conditions.push(eq(events.source_id, opts.sourceId));
  if (opts.after) conditions.push(sql`${events.received_at} > ${opts.after}`);

  let query = db.select().from(events);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  // When tailing (after is set), sort ascending so newest is last
  const order = opts.after ? asc(events.received_at) : desc(events.received_at);
  return query.orderBy(order).limit(limit).offset(offset).all();
}

export async function listDeliveries(
  db: DB,
  opts: { after?: string; destinationId?: string; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;

  const conditions = [];
  if (opts.after) conditions.push(sql`${deliveries.updated_at} > ${opts.after}`);
  if (opts.destinationId) conditions.push(eq(deliveries.destination_id, opts.destinationId));

  let query = db.select().from(deliveries);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query.orderBy(asc(deliveries.updated_at)).limit(limit).all();
}

// --- Deliveries ---

export async function createDelivery(
  db: DB,
  delivery: typeof deliveries.$inferInsert,
) {
  await db.insert(deliveries).values(delivery).run();
}

export async function updateDelivery(
  db: DB,
  id: string,
  fields: Partial<
    Pick<
      typeof deliveries.$inferInsert,
      "status" | "attempt" | "status_code" | "latency_ms" | "response_body" | "next_retry_at"
    >
  >,
) {
  await db
    .update(deliveries)
    .set({
      ...fields,
      updated_at: sql`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    })
    .where(eq(deliveries.id, id))
    .run();
}

export async function getDeliveriesByEvent(db: DB, eventId: string) {
  return db
    .select()
    .from(deliveries)
    .where(eq(deliveries.event_id, eventId))
    .orderBy(asc(deliveries.created_at))
    .all();
}

export async function getFailedDeliveriesByDestination(
  db: DB,
  destinationId: string,
  opts: { limit?: number; offset?: number } = {},
) {
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;
  return db
    .select()
    .from(deliveries)
    .where(
      and(
        eq(deliveries.destination_id, destinationId),
        eq(deliveries.status, "dlq"),
      ),
    )
    .orderBy(desc(deliveries.created_at))
    .limit(limit)
    .offset(offset)
    .all();
}

// --- Consumers ---

export async function getConsumer(db: DB, id: string) {
  return db.select().from(consumers).where(eq(consumers.id, id)).get();
}

export async function getConsumerByName(db: DB, name: string) {
  return db.select().from(consumers).where(eq(consumers.name, name)).get();
}

export async function listConsumers(db: DB) {
  return db.select().from(consumers).orderBy(desc(consumers.created_at)).all();
}

export async function createConsumer(db: DB, consumer: typeof consumers.$inferInsert) {
  await db.insert(consumers).values(consumer).run();
}

export async function updateConsumerCursor(db: DB, id: string, lastAckedAt: string) {
  await db
    .update(consumers)
    .set({
      last_acked_at: lastAckedAt,
      updated_at: sql`strftime('%Y-%m-%dT%H:%M:%SZ', 'now')`,
    })
    .where(eq(consumers.id, id))
    .run();
}

export async function deleteConsumer(db: DB, id: string) {
  await db.delete(consumers).where(eq(consumers.id, id)).run();
}

export async function pollConsumerEvents(
  db: DB,
  opts: { lastAckedAt: string | null; sourceId: string | null; limit: number },
) {
  const conditions = [];
  if (opts.lastAckedAt) {
    conditions.push(sql`${events.received_at} > ${opts.lastAckedAt}`);
  }
  if (opts.sourceId) {
    conditions.push(eq(events.source_id, opts.sourceId));
  }

  let query = db.select().from(events);
  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  return query.orderBy(asc(events.received_at)).limit(opts.limit).all();
}

export async function countFailedDeliveries(db: DB, destinationId: string) {
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.destination_id, destinationId),
        eq(deliveries.status, "dlq"),
      ),
    )
    .get();
  return result?.count ?? 0;
}
