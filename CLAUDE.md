# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

hookflare is an open-source webhook infrastructure service built entirely on the Cloudflare Workers ecosystem. It receives incoming webhooks, queues them durably, and reliably delivers them to configured destinations with retry logic. GitHub org: `hookedge`.

## Tech Stack

- **Runtime**: Cloudflare Workers (TypeScript)
- **Framework**: Hono (lightweight edge-native router)
- **Database**: Cloudflare D1 (SQLite)
- **Queue**: Cloudflare Queues (durable message buffer)
- **Cache**: Cloudflare KV (idempotency keys, config cache)
- **State**: Cloudflare Durable Objects (per-destination retry state machines)
- **Storage**: Cloudflare R2 (webhook payload archive)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start local dev server (wrangler dev)
npm run deploy       # Deploy to Cloudflare
npm test             # Run tests
npm run typecheck    # TypeScript type checking
npm run lint         # Lint
npm run db:migrate:local  # Run D1 migrations locally
```

## Architecture

### Core Flow

1. **Ingress Worker** receives webhook POST at `/webhooks/:source_id`, verifies signature, checks idempotency (KV), returns `202 Accepted`, enqueues to Cloudflare Queue.
2. **Queue Consumer** reads messages, looks up subscriptions in D1, dispatches to the Durable Object for each destination.
3. **Delivery Manager (Durable Object)** — one instance per destination — performs the outbound `fetch()`, manages exponential backoff retries via the alarm API, and logs delivery attempts to D1.

### Key Bindings (wrangler.jsonc)

- `WEBHOOK_QUEUE` — Cloudflare Queue for durable ingestion buffer
- `DELIVERY_DO` — Durable Object namespace for retry state machines
- `DB` — D1 database for config, subscriptions, and delivery logs
- `IDEMPOTENCY_KV` — KV namespace for deduplication keys
- `PAYLOAD_BUCKET` — R2 bucket for webhook payload archive

### Data Model

- **Source** — a webhook sender (e.g., "stripe"), with optional signature verification config
- **Destination** — a target URL to forward webhooks to, with retry policy
- **Subscription** — connects a source to a destination, with optional event type filters
- **Event** — a received webhook payload with metadata
- **Delivery** — a log of each delivery attempt (status code, latency, response snippet)

### API Routes

- `/webhooks/:source_id` — Webhook ingestion endpoint
- `/api/v1/sources|destinations|subscriptions|events` — REST management API

## Code Conventions

- All code, comments, and documentation in US English (en-US).
- Configuration via `wrangler.jsonc` environment variables and D1 database.
