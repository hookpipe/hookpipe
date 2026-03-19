import type { Context, Next } from "hono";
import type { Env } from "../lib/types";
import { createDb } from "../db/queries";
import { verifyApiKey, listApiKeys } from "./keys";

/**
 * Auth middleware for the management API.
 *
 * Priority order:
 * 1. API_TOKEN env var (simple mode) — always checked first
 * 2. D1 API keys (advanced mode) — checked if no env var
 * 3. Bootstrap mode — if no env var and no keys, returns SETUP_REQUIRED
 *
 * Bootstrap mode does NOT allow access. The only unauthenticated endpoint
 * in bootstrap mode is POST /api/v1/bootstrap (handled separately).
 */
export function authMiddleware() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const token = extractToken(c);

    // Simple mode: env var token (timing-safe comparison)
    const envToken = c.env.API_TOKEN;
    if (envToken) {
      if (!token || !timingSafeEqual(token, envToken)) {
        return unauthorized(c);
      }
      await next();
      return;
    }

    // No token provided — check if setup is needed
    if (!token) {
      const db = createDb(c.env.DB);
      const keys = await listApiKeys(db);
      if (keys.length === 0) {
        return setupRequired(c);
      }
      return unauthorized(c);
    }

    // Advanced mode: D1 key lookup
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

/**
 * Timing-safe string comparison to prevent timing attacks on API tokens.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function setupRequired(c: Context) {
  const baseUrl = new URL(c.req.url).origin;
  return c.json(
    {
      error: {
        message: `No API key configured. Create your first key: POST ${baseUrl}/api/v1/bootstrap`,
        code: "SETUP_REQUIRED",
      },
    },
    401,
  );
}
