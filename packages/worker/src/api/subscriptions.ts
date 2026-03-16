import { Hono } from "hono";
import type { Env } from "../lib/types";
import { generateId } from "../lib/id";
import { notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import { parseBody, createSubscriptionSchema } from "../lib/validation";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const subs = await db.listSubscriptions(createDb(c.env.DB));
  return c.json({ data: subs });
});

app.post("/", async (c) => {
  const d = createDb(c.env.DB);
  const body = await parseBody(c, createSubscriptionSchema);

  const source = await db.getSource(d, body.source_id);
  if (!source) throw notFound("Source not found");

  const dest = await db.getDestination(d, body.destination_id);
  if (!dest) throw notFound("Destination not found");

  const id = generateId("sub");
  await db.createSubscription(d, {
    id,
    source_id: body.source_id,
    destination_id: body.destination_id,
    event_types: JSON.stringify(body.event_types),
  });

  const sub = await db.getSubscription(d, id);
  return c.json({ data: sub }, 201);
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await db.getSubscription(createDb(c.env.DB), id);
  if (!existing) throw notFound("Subscription not found");

  await db.deleteSubscription(createDb(c.env.DB), id);
  return c.json({ message: "Deleted" });
});

export { app as subscriptionsApi };
