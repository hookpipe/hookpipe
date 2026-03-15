import type { Context, Next } from "hono";
import type { Env } from "../lib/types";
import { createDb } from "../db/queries";
import { verifyApiKey } from "./keys";

/**
 * Auth middleware for the management API.
 *
 * Supports two modes:
 * 1. Simple mode: single API_TOKEN env var (zero-config)
 * 2. Advanced mode: API keys stored in D1 (multi-key, scopes, revocation)
 *
 * If API_TOKEN env var is set, it takes precedence (simple mode).
 * Otherwise, falls back to D1 key lookup (advanced mode).
 * If neither is configured, all requests are allowed (first-run setup).
 */
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const token = extractToken(c);

    // Simple mode: env var token
    const envToken = c.env.API_TOKEN;
    if (envToken) {
      if (!token || token !== envToken) {
        return unauthorized(c);
      }
      await next();
      return;
    }

    // Advanced mode: D1 key lookup
    if (!token) {
      // Check if any keys exist — if not, allow access (first-run bootstrap)
      const db = createDb(c.env.DB);
      const { listApiKeys } = await import("./keys");
      const keys = await listApiKeys(db);
      if (keys.length === 0) {
        // No keys configured yet — allow access for bootstrap
        await next();
        return;
      }
      return unauthorized(c);
    }

    const db = createDb(c.env.DB);
    const apiKey = await verifyApiKey(db, token);
    if (!apiKey) {
      return unauthorized(c);
    }

    await next();
  };
}

function extractToken(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header) return null;
  if (header.startsWith("Bearer ")) return header.slice(7);
  return header;
}

function unauthorized(c: Context) {
  return c.json(
    { error: { message: "Unauthorized", code: "UNAUTHORIZED" } },
    401,
  );
}
