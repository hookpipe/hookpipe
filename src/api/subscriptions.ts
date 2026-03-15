import { Hono } from "hono";
import type { Env } from "../lib/types";
import { generateId } from "../lib/id";
import { badRequest, notFound } from "../lib/errors";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const subs = await db.listSubscriptions(c.env.DB);
  return c.json({ data: subs });
});

app.post("/", async (c) => {
  const body = await c.req.json<{
    source_id: string;
    destination_id: string;
    event_types?: string[];
  }>();

  if (!body.source_id) throw badRequest("source_id is required");
  if (!body.destination_id) throw badRequest("destination_id is required");

  // Verify source and destination exist
  const source = await db.getSource(c.env.DB, body.source_id);
  if (!source) throw notFound("Source not found");

  const dest = await db.getDestination(c.env.DB, body.destination_id);
  if (!dest) throw notFound("Destination not found");

  const id = generateId("sub");
  await db.createSubscription(c.env.DB, {
    id,
    source_id: body.source_id,
    destination_id: body.destination_id,
    event_types: JSON.stringify(body.event_types ?? ["*"]),
  });

  const sub = await db.getSubscription(c.env.DB, id);
  return c.json({ data: sub }, 201);
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await db.getSubscription(c.env.DB, id);
  if (!existing) throw notFound("Subscription not found");

  await db.deleteSubscription(c.env.DB, id);
  return c.json({ message: "Deleted" });
});

export { app as subscriptionsApi };
