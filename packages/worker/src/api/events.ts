import { Hono } from "hono";
import type { Env } from "../lib/types";
import { notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const sourceId = c.req.query("source_id");
  const after = c.req.query("after");
  const includePayload = c.req.query("include_payload") === "true";
  const defaultLimit = includePayload ? 10 : 50;
  const limit = parseInt(c.req.query("limit") ?? String(defaultLimit), 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const events = await db.listEvents(createDb(c.env.DB), { sourceId, after, limit, offset });

  if (includePayload) {
    const enriched = await Promise.all(
      events.map(async (evt) => {
        if (!evt.payload_r2_key) return { ...evt, payload: null };
        const obj = await c.env.PAYLOAD_BUCKET.get(evt.payload_r2_key);
        const payload = obj ? await obj.text() : null;
        return { ...evt, payload };
      }),
    );
    return c.json({ data: enriched });
  }

  return c.json({ data: events });
});

app.get("/:id", async (c) => {
  const event = await db.getEvent(createDb(c.env.DB), c.req.param("id"));
  if (!event) throw notFound("Event not found");

  // Fetch payload from R2 if available
  let payload: string | null = null;
  if (event.payload_r2_key) {
    const obj = await c.env.PAYLOAD_BUCKET.get(event.payload_r2_key);
    if (obj) payload = await obj.text();
  }

  return c.json({ data: { ...event, payload } });
});

app.get("/:id/deliveries", async (c) => {
  const eventId = c.req.param("id");
  const event = await db.getEvent(createDb(c.env.DB), eventId);
  if (!event) throw notFound("Event not found");

  const deliveries = await db.getDeliveriesByEvent(createDb(c.env.DB), eventId);
  return c.json({ data: deliveries });
});

// List all deliveries (for tailing)
app.get("/deliveries", async (c) => {
  const after = c.req.query("after");
  const destinationId = c.req.query("destination_id");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);

  const deliveries = await db.listDeliveries(createDb(c.env.DB), { after, destinationId, limit });
  return c.json({ data: deliveries });
});

app.post("/:id/replay", async (c) => {
  const eventId = c.req.param("id");
  const event = await db.getEvent(createDb(c.env.DB), eventId);
  if (!event) throw notFound("Event not found");

  if (!event.payload_r2_key) {
    throw notFound("Event payload not found in R2");
  }

  // Re-enqueue the event (payload already in R2, just pass the key)
  await c.env.WEBHOOK_QUEUE.send({
    eventId: event.id,
    sourceId: event.source_id,
    eventType: event.event_type,
    payloadR2Key: event.payload_r2_key,
    headers: event.headers ? JSON.parse(event.headers) : {},
    idempotencyKey: event.idempotency_key,
    receivedAt: new Date().toISOString(),
  });

  return c.json({ message: "Event replayed", event_id: eventId }, 202);
});

export { app as eventsApi };
