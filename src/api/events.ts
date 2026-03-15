import { Hono } from "hono";
import type { Env } from "../lib/types";
import { notFound } from "../lib/errors";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const sourceId = c.req.query("source_id");
  const limit = parseInt(c.req.query("limit") ?? "50", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const events = await db.listEvents(c.env.DB, { sourceId, limit, offset });
  return c.json({ data: events });
});

app.get("/:id", async (c) => {
  const event = await db.getEvent(c.env.DB, c.req.param("id"));
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
  const event = await db.getEvent(c.env.DB, eventId);
  if (!event) throw notFound("Event not found");

  const deliveries = await db.getDeliveriesByEvent(c.env.DB, eventId);
  return c.json({ data: deliveries });
});

app.post("/:id/replay", async (c) => {
  const eventId = c.req.param("id");
  const event = await db.getEvent(c.env.DB, eventId);
  if (!event) throw notFound("Event not found");

  // Re-enqueue the event
  await c.env.WEBHOOK_QUEUE.send({
    eventId: event.id,
    sourceId: event.source_id,
    eventType: event.event_type,
    payloadR2Key: event.payload_r2_key ?? "",
    headers: event.headers ? JSON.parse(event.headers) : {},
    receivedAt: new Date().toISOString(),
  });

  return c.json({ message: "Event replayed", event_id: eventId }, 202);
});

export { app as eventsApi };
