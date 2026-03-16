# hookflare

**Never miss a webhook.** Free, open-source, deploys to Cloudflare in 30 seconds.

[![Build](https://github.com/hookedge/hookflare/actions/workflows/ci.yml/badge.svg)](https://github.com/hookedge/hookflare/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/hookflare)](https://www.npmjs.com/package/hookflare)

> **Status: Alpha** — Core engine is stable and tested. Provider system and `connect` command are [in development](#roadmap).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hookedge/hookflare)

## Why hookflare?

Webhooks are deceptively simple — until they aren't. Providers send them once and move on. If your server is down, slow, or returns an error, that event is gone. hookflare sits between webhook sources and your application to make sure **nothing gets lost**.

- **Never miss a webhook** — Incoming payloads are immediately queued at the edge before your backend even processes them.
- **Reliable delivery** — Automatic retries with exponential backoff, configurable per destination.
- **Signature verification** — Native Stripe (`t=,v1=` format), GitHub (`x-hub-signature-256`), and generic HMAC schemes.
- **Idempotency** — Built-in deduplication so duplicate deliveries don't cause duplicate side effects.
- **Circuit breaker** — Auto-pauses delivery to unhealthy destinations, probes for recovery.
- **Zero infrastructure** — No Docker, PostgreSQL, or Redis. Runs entirely on Cloudflare Workers.
- **Free forever** — Cloudflare Workers free tier handles most workloads. $0 idle cost.

## Status

| Feature | Status | Notes |
|---|---|---|
| Webhook ingestion with signature verification | ✅ Stable | Stripe, GitHub, generic HMAC |
| Reliable delivery with retries (exponential/linear/fixed) | ✅ Stable | Respects `Retry-After` headers |
| Circuit breaker per destination | ✅ Stable | Open/half-open/closed with auto-recovery |
| Fan-out routing (one source → multiple destinations) | ✅ Stable | Event type wildcard filters |
| Dead letter queue with batch replay | ✅ Stable | Per-destination DLQ inspection and replay |
| REST API (CRUD for all resources) | ✅ Stable | Sources, destinations, subscriptions, events, keys |
| API key authentication (simple + advanced mode) | ✅ Stable | Env var or D1-managed keys with scopes |
| CLI with `--json`, `--dry-run`, `--data`, `--fields` | ✅ Stable | Agent-optimized |
| `hookflare schema` (runtime API introspection) | ✅ Stable | Agent-friendly resource discovery |
| Export / Import / Migrate | ✅ Stable | Instance-to-instance migration with ID remapping |
| Idempotency (KV-based deduplication) | ✅ Stable | Configurable TTL |
| Payload archive (R2) | ✅ Stable | Configurable retention |
| Rate limiting (per-source ingress) | ✅ Stable | KV-based with `X-RateLimit` headers |
| `hookflare connect` (one-shot setup) | 🚧 In progress | [#1](https://github.com/hookedge/hookflare/issues) |
| `hookflare providers` (provider catalog) | 🚧 In progress | Browse providers and event types |
| Pre-built providers (Stripe, GitHub, Slack, Shopify, Vercel) | 🚧 In progress | Event catalogs + payload schemas |
| Dashboard (static SPA) | 📋 Planned | Cloudflare Pages, connects to any instance |
| DLQ notifications (webhook/email) | 📋 Planned | Alert when deliveries fail permanently |
| Structured logging | 📋 Planned | JSON logs for observability |

## Quick Start

### One-Click Deploy

Click the Deploy to Cloudflare button above. Cloudflare will provision D1, KV, Queues, Durable Objects, and R2 automatically.

### Manual Setup

```bash
git clone https://github.com/hookedge/hookflare.git
cd hookflare
pnpm install
pnpm --filter @hookflare/shared build
pnpm --filter @hookflare/worker dev
```

### Send Your First Webhook

```bash
# Install the CLI
npm i -g hookflare

# Configure connection to your hookflare instance
hookflare config set api_url http://localhost:8787

# Create a source with Stripe signature verification
hookflare sources create --json -d '{
  "name": "stripe",
  "verification": {"type": "stripe", "secret": "whsec_your_secret"}
}'

# Create a destination (your API)
hookflare dest create --json -d '{
  "name": "my-app",
  "url": "https://myapp.com/webhooks",
  "retry_policy": {"strategy": "exponential", "max_retries": 10}
}'

# Connect them — forward all events
hookflare subs create --json -d '{
  "source_id": "src_xxx",
  "destination_id": "dst_yyy",
  "event_types": ["*"]
}'

# Point Stripe's webhook URL to:
#   https://your-hookflare.workers.dev/webhooks/src_xxx
```

> **Coming soon:** `hookflare connect stripe --secret whsec_xxx --to https://myapp.com/hooks` will do all of the above in one command. See [Roadmap](#roadmap).

## Architecture

hookflare runs entirely on Cloudflare's edge network with zero external dependencies:

```
Webhook Source (Stripe, GitHub, ...)         Your Application (API)
        |                                           ^
        v                                           |
  [Ingress Worker] --> [Queue] --> [Consumer] --> [Delivery DO] --> fetch()
        |                            |               |
        v                            v               v
      [KV]                         [D1]            [R2]
   idempotency                 config/logs     payload archive
```

| Component | Cloudflare Service | Role |
|---|---|---|
| **Ingress Worker** | Workers | Receives webhooks, verifies signatures, enqueues |
| **Message Queue** | Queues | Durable buffer — guarantees no event loss |
| **Consumer Worker** | Workers | Reads from queue, resolves routing, dispatches |
| **Delivery Manager** | Durable Objects | Per-destination retry state machine with backoff |
| **Config & Logs** | D1 (SQLite) | Sources, destinations, subscriptions, delivery logs |
| **Idempotency Cache** | KV | Deduplication keys with TTL |
| **Payload Archive** | R2 | Long-term storage for webhook payloads |

## Retry Policy

Three retry strategies, configurable per destination:

| Strategy | Behavior |
|---|---|
| **exponential** (default) | Delay doubles each attempt with jitter |
| **linear** | Constant interval between retries |
| **fixed** | Same delay every time |

Default exponential schedule (10 retries, 1 min base, 24h cap):

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | ~1 minute |
| 3 | ~2 minutes |
| 4 | ~4 minutes |
| 5 | ~8 minutes |
| 6 | ~16 minutes |
| 7 | ~32 minutes |
| 8 | ~1 hour |
| 9 | ~2 hours |
| 10 | ~4 hours |
| DLQ | After all retries exhausted (~8 hour span) |

Each destination can override strategy, retry count, interval, and which HTTP status codes trigger retries. Destinations can also respond with a `Retry-After` header to control retry timing.

## CLI

```bash
npm i -g hookflare
```

### Agent-Friendly Features

The CLI is designed as an **agent-first** interface — AI agents can operate hookflare without reading documentation:

| Feature | Flag/Command | Purpose |
|---|---|---|
| Structured output | `--json` | Machine-parseable JSON on all commands |
| Raw JSON input | `-d / --data` | Send full API payload, skip flag mapping |
| Schema introspection | `hookflare schema` | Discover API resources and fields at runtime |
| Dry run | `--dry-run` | Validate mutations without executing |
| Field selection | `--fields` | Limit output columns, save context tokens |
| Export/Import | `hookflare export/import` | Pipe-friendly config transfer |
| Migrate | `hookflare migrate` | One-command instance-to-instance migration |

```bash
# Agent workflow: discover → validate → execute
hookflare schema sources                                                    # discover fields
hookflare sources create --json --dry-run -d '{"name":"stripe"}'            # validate
hookflare sources create --json -d '{"name":"stripe","verification":{...}}' # execute
```

See [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) for the full agent guide.

## API Reference

### Sources

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/sources` | Create a source |
| `GET` | `/api/v1/sources` | List sources |
| `GET` | `/api/v1/sources/:id` | Get source details |
| `PUT` | `/api/v1/sources/:id` | Update a source |
| `DELETE` | `/api/v1/sources/:id` | Delete a source |

### Destinations

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/destinations` | Create a destination |
| `GET` | `/api/v1/destinations` | List destinations |
| `GET` | `/api/v1/destinations/:id` | Get destination details |
| `PUT` | `/api/v1/destinations/:id` | Update a destination |
| `DELETE` | `/api/v1/destinations/:id` | Delete a destination |
| `GET` | `/api/v1/destinations/:id/circuit` | Circuit breaker state |
| `GET` | `/api/v1/destinations/:id/failed` | List failed deliveries (DLQ) |
| `POST` | `/api/v1/destinations/:id/replay-failed` | Batch replay all DLQ events |

### Subscriptions

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/subscriptions` | Create a subscription |
| `GET` | `/api/v1/subscriptions` | List subscriptions |
| `DELETE` | `/api/v1/subscriptions/:id` | Delete a subscription |

### Events & Delivery

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/events` | List received events |
| `GET` | `/api/v1/events/:id` | Get event details and payload |
| `GET` | `/api/v1/events/:id/deliveries` | List delivery attempts for an event |
| `POST` | `/api/v1/events/:id/replay` | Replay an event to its destinations |

### API Keys

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/keys` | Create an API key |
| `GET` | `/api/v1/keys` | List API keys |
| `DELETE` | `/api/v1/keys/:id` | Revoke an API key |

### Export / Import

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/export` | Export all configuration |
| `POST` | `/api/v1/import` | Import configuration (dedup by name) |

### Webhook Ingestion

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/:source_id` | Ingest a webhook from a source (public, rate-limited) |

## Roadmap

### v0.1 — Core Engine ✅

Webhook ingestion, queue-based delivery, configurable retry strategies, circuit breaker, API key auth, export/import/migrate, agent-optimized CLI.

### v0.2 — Provider System (current)

- `hookflare connect` one-shot command
- `hookflare providers ls/describe` catalog
- Built-in Stripe, GitHub, Slack providers with event type catalogs and payload schemas
- Community-extensible via `defineProvider()`

### v0.3 — Observability

Structured JSON logging, DLQ notifications (webhook callbacks), health check improvements, delivery metrics.

### v0.4 — Dashboard

Static SPA dashboard on Cloudflare Pages. Connects to any hookflare instance via API URL + token.

### v1.0 — Production Ready

Comprehensive test coverage, load testing results, security audit, stable API, semantic versioning.

## Development

```bash
pnpm install
pnpm --filter @hookflare/shared build
pnpm --filter @hookflare/worker dev       # Start local dev server
pnpm --filter @hookflare/worker test      # Run tests
pnpm --filter @hookflare/worker typecheck # Type check
pnpm --filter hookflare build             # Build CLI
```

## Project Structure

```
hookflare/
├── packages/
│   ├── worker/              # Cloudflare Worker (webhook engine)
│   │   ├── src/
│   │   │   ├── index.ts     # Worker entry point and Hono router
│   │   │   ├── auth/        # API key authentication middleware
│   │   │   ├── ingress/     # Webhook ingestion and signature verification
│   │   │   ├── queue/       # Queue consumer and dispatch logic
│   │   │   ├── delivery/    # Durable Object retry management + circuit breaker
│   │   │   ├── api/         # REST API handlers
│   │   │   ├── db/          # Drizzle ORM schema and queries
│   │   │   └── lib/         # Shared utilities (crypto, errors, IDs)
│   │   ├── migrations/      # D1 database migrations
│   │   └── test/            # Integration tests (vitest + Workers runtime)
│   ├── shared/              # Shared TypeScript types
│   ├── cli/                 # CLI tool (npm: hookflare)
│   └── providers/           # Provider definitions (🚧 in progress)
├── .github/workflows/       # CI (typecheck + test)
├── turbo.json               # Turborepo task config
├── pnpm-workspace.yaml      # pnpm workspaces
└── LICENSE                  # Apache 2.0
```

## How hookflare compares

hookflare focuses on **receiving and reliably forwarding** webhooks. It is not a replacement for outgoing webhook services.

| If you need to... | Consider |
|---|---|
| Receive webhooks and forward to your API | **hookflare**, Hookdeck, Convoy |
| Send webhooks to your customers | Svix, Convoy |
| Both incoming and outgoing | Convoy |

### Why hookflare?

- **Zero infrastructure** — No Docker, PostgreSQL, or Redis. Runs entirely on Cloudflare Workers.
- **Free forever** — Cloudflare Workers free tier handles most workloads. No VM costs, no idle charges.
- **Deploy in 30 seconds** — One-click Cloudflare deploy button provisions everything automatically.
- **Agent-optimized** — CLI with `--json`, `--dry-run`, schema introspection. AI agents can operate hookflare without reading docs.
- **Apache 2.0** — No restrictions on commercial use or self-hosting.

## Contributing

We welcome contributions! The provider system is designed for community participation — each provider is a single file with a well-defined interface. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

## License

[Apache 2.0](LICENSE)

## Disclaimer

hookflare is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" and the Cloudflare logo are trademarks of Cloudflare, Inc.
