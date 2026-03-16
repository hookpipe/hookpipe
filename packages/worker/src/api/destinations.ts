import { Hono } from "hono";
import type { Env } from "../lib/types";
import { generateId } from "../lib/id";
import { notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import { parseBody, createDestinationSchema, updateDestinationSchema } from "../lib/validation";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const destinations = await db.listDestinations(createDb(c.env.DB));
  return c.json({ data: destinations });
});

app.get("/:id", async (c) => {
  const dest = await db.getDestination(createDb(c.env.DB), c.req.param("id"));
  if (!dest) throw notFound("Destination not found");
  return c.json({ data: dest });
});

app.post("/", async (c) => {
  const body = await parseBody(c, createDestinationSchema);

  const rp = body.retry_policy;
  const id = generateId("dst");
  await db.createDestination(createDb(c.env.DB), {
    id,
    name: body.name,
    url: body.url,
    timeout_ms: rp?.timeout_ms ?? 30000,
    retry_strategy: rp?.strategy ?? "exponential",
    max_retries: rp?.max_retries ?? 10,
    retry_interval_ms: rp?.interval_ms ?? 60000,
    retry_max_interval_ms: rp?.max_interval_ms ?? 86400000,
    retry_on_status: rp?.on_status ? JSON.stringify(rp.on_status) : null,
  });

  const dest = await db.getDestination(createDb(c.env.DB), id);
  return c.json({ data: dest }, 201);
});

app.put("/:id", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getDestination(d, id);
  if (!existing) throw notFound("Destination not found");

  const body = await parseBody(c, updateDestinationSchema);

  const rp = body.retry_policy;
  await db.updateDestination(d, id, {
    name: body.name,
    url: body.url,
    timeout_ms: rp?.timeout_ms,
    retry_strategy: rp?.strategy,
    max_retries: rp?.max_retries,
    retry_interval_ms: rp?.interval_ms,
    retry_max_interval_ms: rp?.max_interval_ms,
    retry_on_status: rp?.on_status ? JSON.stringify(rp.on_status) : undefined,
  });

  const dest = await db.getDestination(d, id);
  return c.json({ data: dest });
});

// --- Circuit breaker status ---

app.get("/:id/circuit", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getDestination(d, id);
  if (!existing) throw notFound("Destination not found");

  const doId = c.env.DELIVERY_DO.idFromName(id);
  const doStub = c.env.DELIVERY_DO.get(doId);
  const res = await doStub.fetch("https://do/circuit");
  const circuit = await res.json();

  return c.json({ data: circuit });
});

// --- DLQ operations ---

app.get("/:id/failed", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getDestination(d, id);
  if (!existing) throw notFound("Destination not found");

  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);

  const [failed, count] = await Promise.all([
    db.getFailedDeliveriesByDestination(d, id, { limit, offset }),
    db.countFailedDeliveries(d, id),
  ]);

  return c.json({ data: failed, total: count });
});

app.post("/:id/replay-failed", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getDestination(d, id);
  if (!existing) throw notFound("Destination not found");

  const failed = await db.getFailedDeliveriesByDestination(d, id, { limit: 1000 });

  // Collect unique event IDs
  const eventIds = [...new Set(failed.map((f) => f.event_id))];
  let replayed = 0;

  for (const eventId of eventIds) {
    const event = await db.getEvent(d, eventId);
    if (!event) continue;

    // Fetch payload from R2 for re-enqueue
    let payload = "";
    if (event.payload_r2_key) {
      const obj = await c.env.PAYLOAD_BUCKET.get(event.payload_r2_key);
      if (obj) payload = await obj.text();
    }

    await c.env.WEBHOOK_QUEUE.send({
      eventId: event.id,
      sourceId: event.source_id,
      eventType: event.event_type,
      payload,
      headers: event.headers ? JSON.parse(event.headers) : {},
      idempotencyKey: event.idempotency_key,
      receivedAt: new Date().toISOString(),
    });
    replayed++;
  }

  return c.json({
    message: `Replayed ${replayed} events from ${failed.length} failed deliveries`,
    replayed,
    failed_deliveries: failed.length,
  }, 202);
});

app.delete("/:id", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getDestination(d, id);
  if (!existing) throw notFound("Destination not found");

  await db.deleteDestination(d, id);
  return c.json({ message: "Deleted" });
});

export { app as destinationsApi };
