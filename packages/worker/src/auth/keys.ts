import { eq, and, isNull } from "drizzle-orm";
import type { DB } from "../db/queries";
import { apiKeys } from "../db/schema";
import { generateId } from "../lib/id";

const KEY_PREFIX = "hp_sk_";

/**
 * Generate a cryptographically secure API key.
 * Format: hp_sk_<40 random hex chars>
 * Returns { key, keyHash, keyPrefix } — key is only returned once.
 */
export async function generateApiKey(): Promise<{
  key: string;
  keyHash: string;
  keyPrefix: string;
}> {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = `${KEY_PREFIX}${hex}`;
  const keyHash = await hashKey(key);
  const keyPrefix = key.slice(0, 12); // "hp_sk_xxxx"
  return { key, keyHash, keyPrefix };
}

/**
 * SHA-256 hash of an API key for storage.
 */
export async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verify an API key against D1.
 * Returns the key record if valid, null otherwise.
 */
export async function verifyApiKey(db: DB, rawKey: string) {
  const keyHash = await hashKey(rawKey);
  const now = new Date().toISOString();

  const record = await db
    .select()
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.key_hash, keyHash),
        isNull(apiKeys.revoked_at),
      ),
    )
    .get();

  if (!record) return null;

  // Check expiration
  if (record.expires_at && record.expires_at < now) return null;

  // Update last_used_at (fire and forget)
  db.update(apiKeys)
    .set({ last_used_at: now })
    .where(eq(apiKeys.id, record.id))
    .run()
    .catch(() => {}); // non-blocking

  return record;
}

/**
 * Create a new API key. Returns the full key (only time it's visible).
 */
export async function createApiKeyRecord(
  db: DB,
  opts: { name: string; scopes?: string[]; expiresAt?: string },
) {
  const id = generateId("key");
  const { key, keyHash, keyPrefix } = await generateApiKey();

  await db
    .insert(apiKeys)
    .values({
      id,
      name: opts.name,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      scopes: JSON.stringify(opts.scopes ?? ["admin"]),
      expires_at: opts.expiresAt ?? null,
    })
    .run();

  return { id, key, keyPrefix, name: opts.name };
}

/**
 * List all API keys (without hashes).
 */
export async function listApiKeys(db: DB) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      key_prefix: apiKeys.key_prefix,
      scopes: apiKeys.scopes,
      last_used_at: apiKeys.last_used_at,
      expires_at: apiKeys.expires_at,
      revoked_at: apiKeys.revoked_at,
      created_at: apiKeys.created_at,
    })
    .from(apiKeys)
    .orderBy(apiKeys.created_at)
    .all();
}

/**
 * Revoke an API key.
 */
export async function revokeApiKey(db: DB, id: string) {
  await db
    .update(apiKeys)
    .set({ revoked_at: new Date().toISOString() })
    .where(eq(apiKeys.id, id))
    .run();
}
