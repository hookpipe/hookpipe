/**
 * Consumer API — agent event consumption with cursor tracking.
 *
 * Consumers are lightweight cursor trackers. An agent creates a consumer,
 * polls for unacked events (with payloads), and acks to advance the cursor.
 * On restart, the agent resumes from where it left off.
 */

import { Hono } from "hono";
import type { Env } from "../lib/types";
import { ApiError, notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import * as db from "../db/queries";
import { generateId } from "../lib/id";
import { parseBody, createConsumerSchema, ackConsumerSchema } from "../lib/validation";

const app = new Hono<{ Bindings: Env }>();

// List consumers
app.get("/", async (c) => {
  const consumers = await db.listConsumers(createDb(c.env.DB));
  return c.json({ data: consumers });
});

// Create consumer (or return existing by name)
app.post("/", async (c) => {
  const body = await parseBody(c, createConsumerSchema);

  // Upsert by name — resume existing consumer
  const existing = await db.getConsumerByName(createDb(c.env.DB), body.name);
  if (existing) {
    return c.json({ data: existing }, 200);
  }

  const id = generateId("csm");
  const consumer = {
    id,
    name: body.name,
    source_id: body.source_id ?? null,
    event_types: JSON.stringify(body.event_types),
  };

  await db.createConsumer(createDb(c.env.DB), consumer);
  const created = await db.getConsumer(createDb(c.env.DB), id);
  return c.json({ data: created }, 201);
});

// Get consumer
app.get("/:id", async (c) => {
  const consumer = await db.getConsumer(createDb(c.env.DB), c.req.param("id"));
  if (!consumer) throw notFound("Consumer not found");
  return c.json({ data: consumer });
});

// Delete consumer
app.delete("/:id", async (c) => {
  const consumer = await db.getConsumer(createDb(c.env.DB), c.req.param("id"));
  if (!consumer) throw notFound("Consumer not found");
  await db.deleteConsumer(createDb(c.env.DB), c.req.param("id"));
  return c.json({ message: "Consumer deleted" });
});

// Poll — get unacked events with payloads
app.get("/:id/poll", async (c) => {
  const consumer = await db.getConsumer(createDb(c.env.DB), c.req.param("id"));
  if (!consumer) throw notFound("Consumer not found");

  const limit = parseInt(c.req.query("limit") ?? "10", 10);

  const events = await db.pollConsumerEvents(createDb(c.env.DB), {
    lastAckedAt: consumer.last_acked_at,
    sourceId: consumer.source_id,
    limit,
  });

  // Hydrate payloads from R2 in parallel
  const enriched = await Promise.all(
    events.map(async (evt) => {
      if (!evt.payload_r2_key) return { ...evt, payload: null };
      const obj = await c.env.PAYLOAD_BUCKET.get(evt.payload_r2_key);
      const payload = obj ? await obj.text() : null;
      return { ...evt, payload };
    }),
  );

  return c.json({ data: enriched });
});

// Ack — advance consumer cursor
app.post("/:id/ack", async (c) => {
  const consumer = await db.getConsumer(createDb(c.env.DB), c.req.param("id"));
  if (!consumer) throw notFound("Consumer not found");

  const body = await parseBody(c, ackConsumerSchema);

  let cursor: string;
  if (body.through) {
    cursor = body.through;
  } else if (body.event_id) {
    const event = await db.getEvent(createDb(c.env.DB), body.event_id);
    if (!event) throw new ApiError(400, "Event not found", "EVENT_NOT_FOUND");
    cursor = event.received_at;
  } else {
    throw new ApiError(400, "Provide event_id or through", "INVALID_ACK");
  }

  await db.updateConsumerCursor(createDb(c.env.DB), c.req.param("id"), cursor);
  return c.json({ message: "Acknowledged", last_acked_at: cursor });
});

export { app as consumersApi };
