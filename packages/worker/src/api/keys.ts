import { Hono } from "hono";
import type { Env } from "../lib/types";
import { badRequest, notFound } from "../lib/errors";
import { createDb } from "../db/queries";
import { createApiKeyRecord, listApiKeys, revokeApiKey } from "../auth/keys";
import { apiKeys } from "../db/schema";
import { eq } from "drizzle-orm";

const app = new Hono<{ Bindings: Env }>();

app.get("/", async (c) => {
  const keys = await listApiKeys(createDb(c.env.DB));
  return c.json({ data: keys });
});

app.post("/", async (c) => {
  const body = await c.req.json<{
    name: string;
    scopes?: string[];
    expires_at?: string;
  }>();

  if (!body.name) throw badRequest("name is required");

  const result = await createApiKeyRecord(createDb(c.env.DB), {
    name: body.name,
    scopes: body.scopes,
    expiresAt: body.expires_at,
  });

  return c.json(
    {
      data: result,
      message: "Store this key securely — it will not be shown again.",
    },
    201,
  );
});

app.delete("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");

  const existing = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.id, id))
    .get();
  if (!existing) throw notFound("API key not found");

  await revokeApiKey(db, id);
  return c.json({ message: "API key revoked" });
});

export { app as keysApi };
