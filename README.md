# hookflare

**Never miss a webhook.** Free, open-source, deploys to Cloudflare in 30 seconds.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hookedge/hookflare)

## Why hookflare?

Webhooks are deceptively simple — until they aren't. Providers send them once and move on. If your server is down, slow, or returns an error, that event is gone. hookflare sits between webhook sources and your application to make sure **nothing gets lost**.

- **Never miss a webhook** — Incoming payloads are immediately queued at the edge before your backend even processes them.
- **Reliable delivery** — Automatic retries with exponential backoff, configurable per destination.
- **Idempotency** — Built-in deduplication so duplicate deliveries don't cause duplicate side effects.
- **Signature verification** — Native Stripe, GitHub, and generic HMAC-SHA256 verification built-in.
- **Delivery logs** — Full audit trail of every attempt, status code, and latency.
- **One-click deploy** — Click the button above. Cloudflare provisions everything automatically.

## Architecture

hookflare runs entirely on Cloudflare's edge network with zero external dependencies:

```
Webhook Source                          Your Application
(GitHub, Stripe, etc.)                  (API endpoint)
        │                                       ▲
        ▼                                       │
┌───────────────────────────────────────────────────────────┐
│                   Cloudflare Edge Network                  │
│                                                           │
│   ┌─────────┐    ┌───────┐    ┌───────────┐    ┌─────┐   │
│   │ Ingress │───▶│ Queue │───▶│  Consumer  │───▶│ DO  │──────▶ fetch()
│   │ Worker  │    │       │    │  Worker    │    │     │   │
│   └─────────┘    └───────┘    └───────────┘    └─────┘   │
│        │                           │              │       │
│        ▼                           ▼              ▼       │
│   ┌─────────┐              ┌──────────────┐  ┌───────┐   │
│   │   KV    │              │      D1      │  │  R2   │   │
│   │(idempot-│              │ (config, logs│  │(payload│   │
│   │  ency)  │              │  delivery)   │  │archive)│   │
│   └─────────┘              └──────────────┘  └───────┘   │
│                                                           │
└───────────────────────────────────────────────────────────┘
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

## Features

### Incoming Webhooks

- **Edge ingestion** — Accept webhooks at 300+ global edge locations.
- **Instant ACK** — Return `202 Accepted` immediately after queuing. Webhook sources never time out.
- **Signature verification** — Native Stripe (`t=,v1=` format), GitHub (`x-hub-signature-256`), and generic HMAC schemes.
- **Rate limiting** — Configurable per-source ingress rate limiting (default 100 req/60s) with `X-RateLimit` headers.
- **Idempotency** — Automatic deduplication via idempotency keys stored in KV with configurable TTL.

### Outgoing Delivery

- **Fan-out** — Route one incoming event to multiple destinations based on event type filters.
- **Configurable retry** — Exponential, linear, or fixed strategy per destination. Respects `Retry-After` headers.
- **Circuit breaker** — Auto-pauses delivery to unhealthy destinations after consecutive failures, probes for recovery.
- **Timeout handling** — Configurable per-destination timeout with sensible defaults.
- **Dead letter queue** — Events that exhaust retries are moved to DLQ. Batch replay with one API call.
- **Delivery logs** — Every attempt is logged with status code, latency, and response body snippet.

### Operations

- **REST API** — Manage sources, destinations, subscriptions, and inspect delivery logs.
- **API key authentication** — Simple mode (single env var) or advanced mode (D1-managed keys with scopes, expiration, revocation).
- **Replay** — Re-deliver any past event to any destination with one API call.
- **Export/Import** — Backup and restore configuration. Migrate between instances with one command.
- **Payload archive** — Webhook payloads are archived in R2 for configurable retention periods.

## Quick Start

### One-Click Deploy

Click the Deploy to Cloudflare button at the top of this page. Cloudflare will:

1. Fork this repo to your GitHub account
2. Provision D1, KV, Queues, Durable Objects, and R2 automatically
3. Build and deploy via Workers Builds

### Manual Setup

```bash
# Clone the repo
git clone https://github.com/hookedge/hookflare.git
cd hookflare

# Install dependencies
pnpm install

# Build shared types
pnpm --filter @hookflare/shared build

# Run locally
pnpm --filter @hookflare/worker dev

# Deploy to Cloudflare
pnpm --filter @hookflare/worker deploy
```

### Send Your First Webhook

```bash
# 1. Create a source — Stripe with native signature verification
hookflare sources create --json -d '{
  "name": "stripe",
  "verification": {"type": "stripe", "secret": "whsec_your_stripe_webhook_secret"}
}'

# 2. Create a destination — your API endpoint
hookflare dest create --json -d '{
  "name": "my-app",
  "url": "https://myapp.com/webhooks",
  "retry_policy": {"strategy": "exponential", "max_retries": 10}
}'

# 3. Connect them — forward all Stripe events
hookflare subs create --json -d '{
  "source_id": "src_xxx",
  "destination_id": "dst_yyy",
  "event_types": ["*"]
}'

# 4. Point Stripe's webhook URL to:
#    https://your-hookflare.workers.dev/webhooks/src_xxx
```

hookflare natively verifies Stripe's `stripe-signature` header (timestamp + HMAC-SHA256). Also supports GitHub (`x-hub-signature-256`) and generic HMAC webhooks.

## Configuration

hookflare is configured via `wrangler.jsonc` and D1 database. Core settings:

| Setting | Default | Description |
|---|---|---|
| `IDEMPOTENCY_TTL_S` | `86400` | Idempotency key TTL in seconds (24h) |
| `PAYLOAD_ARCHIVE_DAYS` | `30` | Days to retain payloads in R2 |
| `DELIVERY_TIMEOUT_MS` | `30000` | Per-request delivery timeout (30s) |

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

## CLI

hookflare ships with an agent-optimized CLI. Install it globally:

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
hookflare schema sources                                          # discover fields
hookflare sources create --json --dry-run -d '{"name":"stripe"}'  # validate
hookflare sources create --json -d '{"name":"stripe"}'            # execute
```

See [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) for the full agent guide.

## Development

```bash
# Install dependencies
pnpm install

# Build shared types (required first)
pnpm --filter @hookflare/shared build

# Start local dev server
pnpm --filter @hookflare/worker dev

# Run tests
pnpm --filter @hookflare/worker test

# Run D1 migrations locally
pnpm --filter @hookflare/worker db:migrate:local

# Type check
pnpm --filter @hookflare/worker typecheck

# Build CLI
pnpm --filter hookflare build
```

## Project Structure

```
hookflare/
├── packages/
│   ├── worker/                  # Cloudflare Worker (webhook engine)
│   │   ├── src/
│   │   │   ├── index.ts         # Worker entry point and Hono router
│   │   │   ├── auth/            # API key authentication middleware
│   │   │   ├── ingress/         # Webhook ingestion and signature verification
│   │   │   ├── queue/           # Queue consumer and dispatch logic
│   │   │   ├── delivery/        # Durable Object for retry management
│   │   │   ├── api/             # REST API handlers
│   │   │   ├── db/              # Drizzle ORM schema and queries
│   │   │   └── lib/             # Shared utilities (crypto, errors, IDs)
│   │   ├── migrations/          # D1 database migrations
│   │   ├── test/                # Integration tests (vitest + Workers runtime)
│   │   └── wrangler.jsonc       # Cloudflare Workers configuration
│   ├── shared/                  # Shared TypeScript types
│   └── cli/                     # CLI tool (npm: hookflare)
│       ├── src/commands/        # Command implementations
│       ├── AGENTS.md            # Agent skill file
│       └── tsup.config.ts       # Bundle config
├── turbo.json                   # Turborepo task config
├── pnpm-workspace.yaml          # pnpm workspaces
└── LICENSE                      # Apache 2.0
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

## License

[Apache 2.0](LICENSE)

## Disclaimer

hookflare is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" and the Cloudflare logo are trademarks of Cloudflare, Inc.
