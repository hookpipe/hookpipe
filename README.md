# hookflare

**Never miss a webhook.** Free, open-source, deploys to Cloudflare in 30 seconds.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hookedge/hookflare)

## Why hookflare?

Webhooks are deceptively simple — until they aren't. Providers send them once and move on. If your server is down, slow, or returns an error, that event is gone. hookflare sits between webhook sources and your application to make sure **nothing gets lost**.

- **Never miss a webhook** — Incoming payloads are immediately queued at the edge before your backend even processes them.
- **Reliable delivery** — Automatic retries with exponential backoff, configurable per destination.
- **Idempotency** — Built-in deduplication so duplicate deliveries don't cause duplicate side effects.
- **Signature verification** — Verify incoming webhook signatures (HMAC-SHA256, etc.) before accepting them.
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
- **Signature verification** — Pluggable verifiers for common providers (Stripe, GitHub, Shopify, etc.) and custom HMAC schemes.
- **Idempotency** — Automatic deduplication via idempotency keys stored in KV with configurable TTL.

### Outgoing Delivery

- **Fan-out** — Route one incoming event to multiple destinations based on event type filters.
- **Exponential backoff** — Configurable retry schedule (e.g., 30s, 2m, 15m, 1h, 4h, 24h).
- **Timeout handling** — Configurable per-destination timeout with sensible defaults.
- **Dead letter queue** — Events that exhaust all retries are moved to a DLQ for manual inspection.
- **Delivery logs** — Every attempt is logged with status code, latency, and response body snippet.

### Operations

- **REST API** — Manage sources, destinations, subscriptions, and inspect delivery logs.
- **Replay** — Re-deliver any past event to any destination with one API call.
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
npm install

# Run locally
npm run dev

# Deploy to Cloudflare
npm run deploy
```

### Send Your First Webhook

```bash
# 1. Create a source (the webhook sender)
curl -X POST http://localhost:8787/api/v1/sources \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{"name": "stripe", "verification": {"type": "hmac-sha256", "secret": "whsec_..."}}'

# 2. Create a destination (where to forward)
curl -X POST http://localhost:8787/api/v1/destinations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{"name": "my-app", "url": "https://myapp.com/webhooks", "retry_policy": {"max_retries": 5}}'

# 3. Create a subscription (connect source to destination)
curl -X POST http://localhost:8787/api/v1/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-api-key>" \
  -d '{"source_id": "<source-id>", "destination_id": "<dest-id>", "event_types": ["*"]}'

# 4. Receive a webhook
curl -X POST http://localhost:8787/webhooks/<source-id> \
  -H "Content-Type: application/json" \
  -d '{"event": "payment.completed", "data": {"amount": 4999}}'
```

## Configuration

hookflare is configured via `wrangler.jsonc` and D1 database. Core settings:

| Setting | Default | Description |
|---|---|---|
| `RETRY_MAX_ATTEMPTS` | `5` | Maximum delivery attempts per event |
| `RETRY_BACKOFF_BASE_MS` | `30000` | Base delay for exponential backoff (30s) |
| `RETRY_BACKOFF_MAX_MS` | `86400000` | Maximum backoff delay (24h) |
| `IDEMPOTENCY_TTL_S` | `86400` | Idempotency key TTL in seconds (24h) |
| `PAYLOAD_ARCHIVE_DAYS` | `30` | Days to retain payloads in R2 |
| `DELIVERY_TIMEOUT_MS` | `30000` | Per-request delivery timeout (30s) |

## Retry Policy

Default retry schedule with exponential backoff and jitter:

| Attempt | Delay |
|---|---|
| 1 | Immediate |
| 2 | ~30 seconds |
| 3 | ~2 minutes |
| 4 | ~15 minutes |
| 5 | ~1 hour |
| DLQ | After all retries exhausted |

Each destination can override the default retry policy.

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

### Webhook Ingestion

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/:source_id` | Ingest a webhook from a source |

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

## Comparisons

| Feature | hookflare | Svix | Convoy | Hookdeck |
|---|---|---|---|---|
| Self-hosted | Yes | Yes | Yes | No |
| Serverless | Yes (Cloudflare) | No (Docker) | No (Docker) | N/A |
| One-click deploy | Yes | No | No | N/A |
| Incoming + Outgoing | Yes | Outgoing only | Both | Incoming only |
| Idle cost | $0 | VM cost | VM cost | Free tier |
| Global edge | Yes (300+ PoPs) | No | No | Yes |
| Agent-optimized CLI | Yes | No | No | No |
| Schema introspection | Yes | No | No | No |
| Export/Import/Migrate | Yes | Partial | Partial | No |

## License

[Apache 2.0](LICENSE)

## Disclaimer

hookflare is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" and the Cloudflare logo are trademarks of Cloudflare, Inc.
