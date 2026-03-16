import { env } from "cloudflare:test";
import { SELF } from "cloudflare:test";

const TABLES = [
  `CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, verification_type TEXT, verification_secret TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`,
  `CREATE TABLE IF NOT EXISTS destinations (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, url TEXT NOT NULL, timeout_ms INTEGER NOT NULL DEFAULT 30000, retry_strategy TEXT NOT NULL DEFAULT 'exponential', max_retries INTEGER NOT NULL DEFAULT 10, retry_interval_ms INTEGER NOT NULL DEFAULT 60000, retry_max_interval_ms INTEGER NOT NULL DEFAULT 86400000, retry_on_status TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`,
  `CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE, event_types TEXT NOT NULL DEFAULT '["*"]', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), UNIQUE(source_id, destination_id))`,
  `CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, event_type TEXT, idempotency_key TEXT, payload_r2_key TEXT, headers TEXT, received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`,
  `CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, destination_id TEXT NOT NULL REFERENCES destinations(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', attempt INTEGER NOT NULL DEFAULT 0, status_code INTEGER, latency_ms INTEGER, response_body TEXT, next_retry_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`,
  `CREATE TABLE IF NOT EXISTS api_keys (id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '["admin"]', last_used_at TEXT, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')))`,
];

// Stores the test API key after bootstrap
let testApiKey: string | null = null;

export async function migrateDb() {
  await env.DB.batch(TABLES.map((sql) => env.DB.prepare(sql)));
  testApiKey = null; // Reset on each test
}

/**
 * Bootstrap the instance and return the admin API key.
 * Caches the key for the current test.
 */
export async function bootstrap(): Promise<string> {
  if (testApiKey) return testApiKey;

  const res = await SELF.fetch(
    new Request("http://localhost/api/v1/bootstrap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-admin" }),
    }),
  );
  const body = await res.json<{ data: { key: string } }>();
  testApiKey = body.data.key;
  return testApiKey;
}

/**
 * Make a request to the worker under test.
 * Automatically includes auth header if a key has been bootstrapped.
 */
export function request(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const { method = "GET", body, headers = {} } = opts ?? {};

  // Auto-inject auth if bootstrapped and not already provided
  const finalHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...headers,
  };
  if (testApiKey && !finalHeaders["Authorization"]) {
    finalHeaders["Authorization"] = `Bearer ${testApiKey}`;
  }

  return new Request(`http://localhost${path}`, {
    method,
    headers: finalHeaders,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Make an unauthenticated request (no auto-injected auth).
 */
export function unauthRequest(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  },
) {
  const { method = "GET", body, headers = {} } = opts ?? {};

  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
