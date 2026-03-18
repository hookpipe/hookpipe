import { Hono } from "hono";
import type { Env } from "../lib/types";
import { createDb } from "../db/queries";
import { createApiKeyRecord, listApiKeys } from "../auth/keys";

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /api/v1/bootstrap
 *
 * Creates the first admin API key on a fresh deployment.
 * No authentication required — but only works when no keys exist.
 * After first successful call, this endpoint returns 403 permanently.
 *
 * This is the only unauthenticated management endpoint.
 */
app.post("/bootstrap", async (c) => {
  // If API_TOKEN env var is set, bootstrap is unnecessary
  if (c.env.API_TOKEN) {
    return c.json(
      {
        error: {
          message: "API_TOKEN environment variable is already set. Use it as your Bearer token.",
          code: "BOOTSTRAP_UNNECESSARY",
        },
      },
      403,
    );
  }

  const db = createDb(c.env.DB);

  // Check if any keys already exist (atomic: D1 query)
  const existingKeys = await listApiKeys(db);
  if (existingKeys.length > 0) {
    return c.json(
      {
        error: {
          message: "Bootstrap already completed. Use your API key to authenticate.",
          code: "BOOTSTRAP_COMPLETED",
        },
      },
      403,
    );
  }

  // Parse optional name (default: "admin")
  let name = "admin";
  try {
    const body = await c.req.json<{ name?: string }>();
    if (body.name && typeof body.name === "string" && body.name.length > 0) {
      name = body.name;
    }
  } catch {
    // Empty body or invalid JSON is fine — use default name
  }

  // Create the first admin key
  const result = await createApiKeyRecord(db, {
    name,
    scopes: ["admin"],
  });

  // Verify the key was actually created (atomic check)
  const keysAfter = await listApiKeys(db);
  if (keysAfter.length !== 1 || keysAfter[0].id !== result.id) {
    // Race condition: someone else bootstrapped concurrently
    return c.json(
      {
        error: {
          message: "Bootstrap conflict. Another key was created. Use API_TOKEN env var to recover.",
          code: "BOOTSTRAP_CONFLICT",
        },
      },
      409,
    );
  }

  return c.json(
    {
      data: {
        key: result.key,
        key_prefix: result.keyPrefix,
        name: result.name,
        id: result.id,
      },
      message: "Store this key securely — it will not be shown again. Configure your CLI: hookpipe config set token " + result.key,
    },
    201,
  );
});

export { app as bootstrapApi };
