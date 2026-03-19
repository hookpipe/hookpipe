# hookpipe

**Never miss a webhook.** Open-source webhook infrastructure with agent-native API.

[![npm version](https://img.shields.io/npm/v/hookpipe)](https://www.npmjs.com/package/hookpipe)
[![CI](https://github.com/hookpipe/hookpipe/actions/workflows/ci.yml/badge.svg)](https://github.com/hookpipe/hookpipe/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/hookpipe)](https://github.com/hookpipe/hookpipe/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://github.com/hookpipe/hookpipe)

```bash
npm i -g hookpipe    # also available as `hp`
```

## Why hookpipe?

- **Queue-backed, not tunnel-based** — webhooks are durably queued at 300+ Cloudflare edge locations. Unlike ngrok/smee, nothing is lost when your server goes down.
- **Type-safe webhook SDK** — [`@hookpipe/providers`](https://www.npmjs.com/package/@hookpipe/providers) ships `createVerifier()` + `createHandler()` with 530+ event types generated from official Stripe and GitHub SDK types. Works standalone in any runtime.
- **Agent-native** — three integration paths: CLI subprocess (`--json`), event streaming (`hp listen`), and MCP server (`hp mcp`). No other webhook tool offers this.

## How It Works

```
Stripe/GitHub/Slack → hookpipe (Cloudflare edge) → your API
                      ├─ verify signature
                      ├─ queue durably
                      ├─ retry with backoff
                      └─ never lose an event
```

hookpipe sits between webhook providers and your application. It verifies signatures, queues events durably, and delivers them with automatic retries, circuit breaking, and a dead letter queue. Runs on your own Cloudflare account — $0 on free tier, deploy in 30 seconds.

## Quick Start

```bash
# 1. Deploy (or run locally)
git clone https://github.com/hookpipe/hookpipe.git && cd hookpipe
pnpm install && pnpm --filter @hookpipe/shared build && pnpm --filter @hookpipe/providers build
pnpm --filter @hookpipe/worker db:migrate:local && pnpm --filter @hookpipe/worker dev

# 2. Bootstrap
hookpipe config set api_url http://localhost:8787
hookpipe init

# 3. Connect Stripe and stream events
hookpipe connect stripe --secret whsec_test --to https://httpbin.org/post
hookpipe tail --payload
```

For production deployment, see the [deployment guide on GitHub](https://github.com/hookpipe/hookpipe#quick-start).

## What It Looks Like

```
$ hp connect stripe --secret whsec_test --to https://api.myapp.com/hooks

✓ Connected stripe → https://api.myapp.com/hooks
  Webhook URL: https://your-hookpipe.workers.dev/webhooks/src_a1b2c3

$ hp tail --payload --source src_a1b2c3

[10:00:01] evt_f7e8d9 ← src_a1b2c3  payment_intent.succeeded
         {"id":"pi_3xyz","amount":4999,"currency":"usd","status":"succeeded"}
[10:00:01] evt_f7e8d9 → dst_c4d5e6  ✓ 200 (45ms)
[10:02:15] evt_a1b2c3 ← src_a1b2c3  charge.refunded
         {"id":"ch_1abc","amount_refunded":4999,"currency":"usd"}
[10:02:15] evt_a1b2c3 → dst_c4d5e6  ✗ 503 (2100ms) — retrying in 60s
[10:03:16] evt_a1b2c3 → dst_c4d5e6  ✓ 200 (38ms) attempt 2
```

## Your Webhook Handler

hookpipe forwards the original payload to your destination URL as an HTTP POST. Your handler receives the same body the provider sent, plus hookpipe headers:

```typescript
// Express / Hono / any framework
app.post('/webhooks', (req, res) => {
  // hookpipe headers
  const eventId    = req.headers['x-hookpipe-event-id'];    // "evt_abc123"
  const deliveryId = req.headers['x-hookpipe-delivery-id']; // "dlv_def456"
  const attempt    = req.headers['x-hookpipe-attempt'];      // "1"

  // Original provider payload (JSON body as-is)
  const { type, data } = req.body;
  console.log(`${type}: ${data.object.id}`);

  // Return 2xx to acknowledge. Any non-2xx triggers retry.
  res.status(200).json({ received: true });
});
```

Your handler should be idempotent — hookpipe guarantees at-least-once delivery, so the same event may arrive more than once. Use `x-hookpipe-event-id` for deduplication.

## Agent Integration

hookpipe is designed for AI agents. Three integration paths, pick what fits your architecture:

### Event Streaming — `hp listen`

Server-side cursor tracking with auto-ack. Your agent resumes from where it left off after restart.

```bash
hp listen --consumer my-bot --source src_stripe | python agent.py
```

| | `tail --payload` | `listen --consumer` |
|---|---|---|
| Purpose | Debugging / monitoring | Reliable agent consumption |
| Cursor | Client-side (starts from now) | Server-side (resumes after restart) |
| Ack | None | Auto-ack after stdout write |
| Backpressure | None | Pauses when pipe buffer full |
| Output | Events + deliveries mixed | Events only (clean NDJSON) |

NDJSON output (one JSON object per line):

```jsonl
{"id":"evt_abc","source_id":"src_stripe","event_type":"payment_intent.succeeded","received_at":"2026-03-18T10:00:00Z","payload":{"id":"pi_xxx","amount":2000,"currency":"usd"}}
```

Flags: `--consumer <name>` (resumable), `--source <id>`, `--events <filter>`, `--limit <n>`, `--timeout <dur>`, `--no-ack`.

### MCP Server — `hp mcp`

Any MCP-compatible LLM client (Claude Desktop, Cursor, Windsurf) can operate hookpipe directly.

```json
{
  "mcpServers": {
    "hookpipe": { "command": "hookpipe", "args": ["mcp"] }
  }
}
```

Two tools with progressive disclosure:

- **`hookpipe_schema`** — discover resources, fields, available operations
- **`hookpipe_execute`** — execute any operation (`sources.list`, `events.get`, `providers.describe`, etc.)

Example interaction (what the LLM sees):

```
LLM → hookpipe_schema({ resource: "events" })
    ← { operations: ["events.list", "events.get", "events.replay"],
         list_args: { source_id: "string", limit: "number", include_payload: "boolean" } }

LLM → hookpipe_execute({ command: "events.list", args: { source_id: "src_stripe", limit: 3 } })
    ← { data: [
         { id: "evt_abc", event_type: "payment_intent.succeeded", received_at: "..." },
         { id: "evt_def", event_type: "charge.refunded", received_at: "..." },
         ...
       ] }

LLM → hookpipe_execute({ command: "events.replay", args: { id: "evt_abc" } })
    ← { message: "Event replayed", event_id: "evt_abc" }
```

MCP handles request-response operations. For real-time event streaming, use `hp listen` instead.

### CLI Subprocess

The discover → validate → execute pattern:

```bash
hp schema sources                                         # discover fields
hp connect stripe --dry-run --json -d '{"secret":"..."}'  # validate
hp connect stripe --json -d '{"secret":"..."}'            # execute
```

All commands support `--json` (structured output), `--dry-run` (safe validation), `-d/--data` (raw JSON input), `--fields` (limit output columns).

See [AGENTS.md](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md) for the complete agent guide — error codes, ID formats, idempotency guarantees, and workflow recipes.

## SDK — @hookpipe/providers

Standalone webhook SDK. Works without hookpipe runtime, in any TypeScript project.

```bash
npm i @hookpipe/providers
```

### Verify signatures — one API for every provider

```typescript
import { stripe, createVerifier } from '@hookpipe/providers';

const verify = createVerifier(stripe, { secret: 'whsec_xxx' });
const isValid = await verify(rawBody, requestHeaders);
// Works with Stripe, GitHub, Slack, Shopify, Vercel — same API
```

### Full webhook handler

```typescript
import { stripe, createHandler } from '@hookpipe/providers';

const webhook = createHandler(stripe, { secret: 'whsec_xxx' });
const result = await webhook.handle(body, headers);

if (result.isChallenge) return res.json(result.challengeResponse);
if (!result.verified) return res.status(401).end();
console.log(result.eventType, result.payload);
```

### Browse 530+ event types

```typescript
import { stripe } from '@hookpipe/providers';
Object.keys(stripe.events).length;  // 260 — generated from stripe@20.4.1 SDK types
```

Per-provider imports for tree-shaking: `@hookpipe/providers/stripe`, `@hookpipe/providers/github`, etc.

Uses Web Crypto API — runs in Node.js 18+, Cloudflare Workers, Deno, Bun. Zero runtime dependencies beyond zod.

[Full SDK docs](https://www.npmjs.com/package/@hookpipe/providers)

## Built-in Providers

| Provider | Events | Verification | Schemas | Challenge |
|----------|--------|-------------|---------|-----------|
| Stripe   | 260    | `stripe-signature` (timestamp + HMAC-SHA256) | 3 events | — |
| GitHub   | 277    | `hmac-sha256` | 2 events | — |
| Slack    | 10     | `slack-signature` (timestamp + HMAC-SHA256) | — | `url_verification` |
| Shopify  | 17     | `hmac-sha256` (base64) | — | — |
| Vercel   | 9      | `hmac-sha1` | — | — |

Stripe and GitHub catalogs are auto-generated from official SDK types. Regenerate with `pnpm gen`.

Custom verification schemes (e.g. HASH IV/KEY for Taiwan payment gateways) are supported via the `custom` verification type.

## Key Commands

| Command | Description |
|---|---|
| `hp connect <provider>` | One-shot setup: source + destination + subscription |
| `hp tail --payload` | Stream events with full payloads (NDJSON) |
| `hp listen --consumer <name>` | Agent consumption pipeline — resumable, auto-ack, backpressure |
| `hp mcp` | Start MCP server for LLM integration |
| `hp dev --port <n>` | Local development tunnel with signature verification |

<details>
<summary>All commands</summary>

| Command | Description |
|---|---|
| `hp init` | Bootstrap admin API key on a fresh instance |
| `hp providers ls/describe` | Browse provider event catalogs and verification methods |
| `hp sources create/ls/get/rm` | Manage webhook receiving endpoints |
| `hp dest create/ls/get/rm` | Manage delivery destinations with retry policies |
| `hp subs create/ls/rm` | Manage routing rules (source → destination) |
| `hp events ls/get/replay` | Inspect received events and replay failed deliveries |
| `hp export/import` | Backup and restore configuration |
| `hp migrate` | Instance-to-instance migration |
| `hp schema [resource]` | Runtime API schema introspection |
| `hp config set/get` | CLI configuration (`api_url`, `token`) |
| `hp health` | Check server connectivity and setup status |

</details>

## Links

- [GitHub](https://github.com/hookpipe/hookpipe) — source code, architecture, benchmarks
- [`@hookpipe/providers`](https://www.npmjs.com/package/@hookpipe/providers) — standalone webhook SDK with `createVerifier()`, `createHandler()`, and 530+ event types
- [Agent Guide](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md) — error codes, ID formats, idempotency, workflow recipes

## Get Started in 30 Seconds

```bash
npm i -g hookpipe
hookpipe config set api_url https://your-hookpipe.workers.dev
hookpipe init
hookpipe connect stripe --secret whsec_xxx --to https://myapp.com/webhooks
```

[Deploy your own instance](https://github.com/hookpipe/hookpipe#quick-start) | [Agent Guide](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md) | [GitHub](https://github.com/hookpipe/hookpipe)

## License

[Apache 2.0](https://github.com/hookpipe/hookpipe/blob/main/LICENSE)
