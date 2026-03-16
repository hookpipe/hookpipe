import { Hono } from "hono";
import type { Env } from "../lib/types";
import { generateId } from "../lib/id";
import { notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import { maskSourceSecret } from "../lib/mask";
import { parseBody, createSourceSchema, updateSourceSchema } from "../lib/validation";
import * as db from "../db/queries";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const sources = await db.listSources(createDb(c.env.DB));
  return c.json({ data: sources.map(maskSourceSecret) });
});

app.get("/:id", async (c) => {
  const source = await db.getSource(createDb(c.env.DB), c.req.param("id"));
  if (!source) throw notFound("Source not found");
  return c.json({ data: maskSourceSecret(source) });
});

app.post("/", async (c) => {
  const d = createDb(c.env.DB);
  const body = await parseBody(c, createSourceSchema);

  const id = generateId("src");
  await db.createSource(d, {
    id,
    name: body.name,
    verification_type: body.verification?.type ?? null,
    verification_secret: body.verification?.secret ?? null,
  });

  const source = await db.getSource(d, id);
  return c.json({ data: source }, 201);
});

app.put("/:id", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getSource(d, id);
  if (!existing) throw notFound("Source not found");

  const body = await parseBody(c, updateSourceSchema);

  await db.updateSource(d, id, {
    name: body.name,
    verification_type: body.verification?.type,
    verification_secret: body.verification?.secret,
  });

  const source = await db.getSource(d, id);
  return c.json({ data: source ? maskSourceSecret(source) : null });
});

app.delete("/:id", async (c) => {
  const d = createDb(c.env.DB);
  const id = c.req.param("id");
  const existing = await db.getSource(d, id);
  if (!existing) throw notFound("Source not found");

  await db.deleteSource(d, id);
  return c.json({ message: "Deleted" });
});

export { app as sourcesApi };
