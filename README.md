# hookflare

**Never miss a webhook.** Free, open-source, deploys to Cloudflare in 30 seconds.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/hookedge/hookflare)

## Quick Start

```bash
npm i -g hookflare

hookflare connect stripe \
  --secret whsec_your_stripe_webhook_secret \
  --to https://myapp.com/webhooks \
  --events "payment_intent.*"
```

That's it. One command creates a source, destination, and subscription. hookflare returns a webhook URL — paste it into your Stripe Dashboard.

## Why hookflare?

Webhooks are deceptively simple — until they aren't. Providers send them once and move on. If your server is down, slow, or returns an error, that event is gone. hookflare sits between webhook sources and your application to make sure **nothing gets lost**.

- **Never miss a webhook** — Incoming payloads are immediately queued at the edge before your backend even processes them.
- **Reliable delivery** — Automatic retries with exponential backoff, configurable per destination.
- **Built-in providers** — Stripe, GitHub, Slack, Shopify, Vercel — signature verification, event catalogs, and payload schemas out of the box.
- **Idempotency** — Built-in deduplication so duplicate deliveries don't cause duplicate side effects.
- **Delivery logs** — Full audit trail of every attempt, status code, and latency.
- **One-click deploy** — Click the button above. Cloudflare provisions everything automatically.

## Providers

Providers are pre-built knowledge modules that handle signature verification, event type catalogs, and payload schemas for each webhook sender. Think of them like Terraform providers — pluggable, typed, community-extensible.

Each provider declares **capabilities** — what it knows and can do:

| Capability | What it does | Status |
|---|---|---|
| `verify` | Validate webhook signatures | Built-in |
| `events` | Typed event catalog with descriptions | Built-in |
| `parse` | Extract event type and ID from payload | Built-in |
| `challenge` | Handle URL verification (Slack, Discord) | Built-in |
| `mock` | Generate fake events for development | Planned |
| `schema` | Zod payload schemas for type-safe handlers | Planned |
| `normalize` | Unify payload format across providers | Planned |

Every capability is optional. The minimum provider is three fields and one file. See [`packages/providers/DESIGN.md`](packages/providers/DESIGN.md) for the full spec.

| Provider | Events | Verification |
|---|---|---|
| **Stripe** | `payment_intent.*`, `customer.*`, `invoice.*`, `charge.*` | `stripe-signature` (HMAC-SHA256 + timestamp) |
| **GitHub** | `push`, `pull_request`, `issues`, `release`, ... | `x-hub-signature-256` (HMAC-SHA256) |
| **Slack** | `message`, `app_mention`, `url_verification`, ... | `x-slack-signature` (HMAC-SHA256 + timestamp) |
| **Shopify** | `orders/*`, `products/*`, `customers/*`, ... | `x-shopify-hmac-sha256` (Base64 HMAC-SHA256) |
| **Vercel** | `deployment.*`, `domain.*`, ... | `x-vercel-signature` (HMAC-SHA1) |

```bash
# Discover available providers
hookflare providers ls

# Inspect a provider's events and schemas
hookflare providers describe stripe --json
```

### Custom Providers

Need a provider that isn't built-in? Use generic HMAC verification:

```bash
hookflare connect my-service \
  --verification hmac-sha256 \
  --secret my_signing_secret \
  --to https://myapp.com/hooks
```

Or build a provider with `defineProvider()` and publish it to npm:

```typescript
import { defineProvider } from 'hookflare/provider';

export default defineProvider({
  id: 'linear',
  name: 'Linear',
  verification: { header: 'linear-signature', algorithm: 'hmac-sha256' },
  events: {
    'Issue.create': 'New issue created',
    'Issue.update': 'Issue updated',
    'Comment.create': 'New comment added',
  },
});
```

Community providers follow the `hookflare-provider-*` naming convention on npm.

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

## Features

### Incoming Webhooks

- **Edge ingestion** — Accept webhooks at 300+ global edge locations.
- **Instant ACK** — Return `202 Accepted` immediately after queuing. Webhook sources never time out.
- **Provider-aware verification** — Each provider's signature format is handled natively. No manual crypto code.
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

## CLI

```bash
npm i -g hookflare
```

### Connect in one command

```bash
# Stripe → your API
hookflare connect stripe --secret whsec_xxx --to https://myapp.com/hooks --events "payment_intent.*"

# GitHub → your API
hookflare connect github --secret ghsec_xxx --to https://myapp.com/hooks --events "push,pull_request"

# Multiple environments
hookflare connect stripe --secret whsec_prod --to https://api.myapp.com/hooks --name stripe-prod
hookflare connect stripe --secret whsec_stg --to https://staging.myapp.com/hooks --name stripe-staging
```

### Discover providers

```bash
hookflare providers ls
hookflare providers describe stripe --json
```

### Advanced: individual resources

```bash
hookflare sources create -d '{...}'
hookflare dest create -d '{...}'
hookflare subs create -d '{...}'
```

### Agent-Friendly Features

The CLI is designed as an **agent-first** interface — AI agents can operate hookflare without reading documentation:

| Feature | Flag/Command | Purpose |
|---|---|---|
| One-shot setup | `hookflare connect` | Source + destination + subscription in one command |
| Structured output | `--json` | Machine-parseable JSON on all commands |
| Raw JSON input | `-d / --data` | Send full API payload, skip flag mapping |
| Provider discovery | `hookflare providers describe` | Event types and schemas at runtime |
| Schema introspection | `hookflare schema` | Discover API resources and fields |
| Dry run | `--dry-run` | Validate mutations without executing |
| Field selection | `--fields` | Limit output columns, save context tokens |
| Export/Import | `hookflare export/import` | Pipe-friendly config transfer |
| Migrate | `hookflare migrate` | One-command instance-to-instance migration |

```bash
# Agent workflow: discover → validate → execute
hookflare providers describe stripe --json                         # discover events
hookflare connect stripe --secret whsec_xxx --to https://... --dry-run  # validate
hookflare connect stripe --secret whsec_xxx --to https://... --json     # execute
```

See [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) for the full agent guide.

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

## Configuration

hookflare is configured via `wrangler.jsonc` and D1 database. Core settings:

| Setting | Default | Description |
|---|---|---|
| `IDEMPOTENCY_TTL_S` | `86400` | Idempotency key TTL in seconds (24h) |
| `PAYLOAD_ARCHIVE_DAYS` | `30` | Days to retain payloads in R2 |
| `DELIVERY_TIMEOUT_MS` | `30000` | Per-request delivery timeout (30s) |

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
│   ├── cli/                     # CLI tool (npm: hookflare)
│   │   ├── src/commands/        # Command implementations
│   │   ├── AGENTS.md            # Agent skill file
│   │   └── tsup.config.ts       # Bundle config
│   └── providers/               # Built-in provider definitions
│       ├── stripe/
│       ├── github/
│       ├── slack/
│       ├── shopify/
│       └── vercel/
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
- **Provider ecosystem** — Built-in providers with typed event catalogs. Community-extensible via `defineProvider()`.
- **Agent-optimized** — CLI with `--json`, `--dry-run`, provider discovery. AI agents can operate hookflare without reading docs.
- **Apache 2.0** — No restrictions on commercial use or self-hosting.

## License

[Apache 2.0](LICENSE)

## Disclaimer

hookflare is not affiliated with, endorsed by, or sponsored by Cloudflare, Inc. "Cloudflare" and the Cloudflare logo are trademarks of Cloudflare, Inc.
