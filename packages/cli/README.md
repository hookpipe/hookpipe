# hookflare

**Never miss a webhook.** CLI for [hookflare](https://github.com/hookedge/hookflare) — open-source webhook infrastructure on Cloudflare Workers.

```bash
npm i -g hookflare
```

## How it Works

```
Stripe/GitHub/Slack → hookflare (Cloudflare edge) → your API
                      ├─ verify signature
                      ├─ queue durably
                      ├─ retry with backoff
                      └─ never lose an event
```

hookflare sits between webhook providers and your application. It accepts webhooks at 300+ Cloudflare edge locations, verifies signatures, and reliably delivers them to your API with automatic retries, circuit breaking, and a dead letter queue. Zero servers to manage, zero idle cost.

**Why hookflare?** Unlike SaaS webhook tools (Hookdeck, Svix), hookflare runs on **your own** Cloudflare account — you own the data, pay Cloudflare directly ($0 on free tier for most workloads), and deploy in 30 seconds.

## Try it Locally (2 minutes)

```bash
# 1. Clone and start
git clone https://github.com/hookedge/hookflare.git && cd hookflare
pnpm install && pnpm --filter @hookflare/shared build && pnpm --filter @hookflare/providers build
pnpm --filter @hookflare/worker db:migrate:local
pnpm --filter @hookflare/worker dev   # starts on http://localhost:8787

# 2. In another terminal — install CLI and bootstrap
npm i -g hookflare
hookflare config set api_url http://localhost:8787
hookflare init

# 3. Create a Stripe webhook pipeline
hookflare connect stripe --secret whsec_test --to https://httpbin.org/post

# 4. Send a test webhook
curl -X POST http://localhost:8787/webhooks/<source_id_from_output> \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded","data":{"amount":4999}}'

# 5. Check delivery
hookflare events ls
```

## Quick Start (Production)

### 1. Deploy hookflare

See the [deployment guide on GitHub](https://github.com/hookedge/hookflare#quick-start) — one-click deploy to Cloudflare or `npx wrangler deploy`.

### 2. Install the CLI and bootstrap

```bash
npm i -g hookflare
hookflare config set api_url https://your-hookflare.workers.dev
hookflare init    # creates your admin API key (stored automatically)
```

`init` calls the one-time bootstrap endpoint to create your first API key. The key is saved to `~/.hookflare/config.json`. All subsequent commands authenticate with it. Running `init` again on an already-bootstrapped instance is a no-op.

### 3. Set up Stripe webhooks

```bash
hookflare connect stripe \
  --secret whsec_your_secret \
  --to https://api.myapp.com/hooks \
  --events "payment_intent.*"
```

Output:

```
✓ Source created: src_a1b2c3 (stripe, signature verification enabled)
✓ Destination created: dst_d4e5f6 (https://api.myapp.com/hooks)
✓ Subscription created: sub_g7h8i9 (payment_intent.*)

Webhook URL: https://your-hookflare.workers.dev/webhooks/src_a1b2c3

Next: Add this URL to your Stripe Dashboard → Developers → Webhooks.
```

Omit `--events` to forward all events. hookflare forwards the original payload as-is to your destination with these headers added: `X-Hookflare-Event-Id`, `X-Hookflare-Delivery-Id`, `X-Hookflare-Attempt`.

If delivery fails, hookflare retries automatically with exponential backoff (up to 10 attempts over ~8 hours). Events that exhaust all retries are moved to a dead letter queue for manual replay. You can configure retry strategy (exponential/linear/fixed), max attempts, and which HTTP status codes trigger retries — per destination.

## What You Can Do

- **Connect providers** — Stripe, GitHub, Slack, Shopify, Vercel with one command
- **Inspect & replay events** — view delivery attempts, replay failed events
- **Monitor health** — circuit breaker status, DLQ inspection, real-time streaming with `hookflare tail`
- **Manage routing** — fan-out one source to multiple destinations with event type filters
- **Backup & migrate** — export/import configuration, one-command instance-to-instance migration

## Agent-Friendly

The CLI is built for AI agents. See [AGENTS.md](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md) for the complete guide.

```bash
# Discover → Validate → Execute
hookflare schema sources                              # discover fields at runtime
hookflare connect stripe --dry-run --json -d '{...}'   # validate without creating
hookflare connect stripe --json -d '{...}'             # execute, get JSON output
```

`--json` output example:

```json
{
  "data": {
    "source": { "id": "src_a1b2c3", "name": "stripe", "provider": "stripe" },
    "destination": { "id": "dst_d4e5f6", "url": "https://api.myapp.com/hooks" },
    "subscription": { "id": "sub_g7h8i9", "event_types": ["payment_intent.*"] },
    "webhook_url": "https://your-hookflare.workers.dev/webhooks/src_a1b2c3"
  }
}
```

Key flags: `--json` (structured output), `--dry-run` (safe validation), `-d/--data` (raw JSON input), `--fields` (limit output columns), `hookflare schema` (API introspection).

## Commands

| Command | Description |
|---|---|
| `connect <provider>` | One-shot setup: source + destination + subscription |
| `init` | Bootstrap admin API key on a fresh instance |
| `providers ls/describe` | Browse supported providers, events, and verification |
| `sources create/ls/get/rm` | Manage webhook receiving endpoints |
| `dest create/ls/get/rm` | Manage delivery destinations with retry policies |
| `subs create/ls/rm` | Manage routing rules (source → destination) |
| `events ls/get/replay` | Inspect received events and replay failed deliveries |
| `tail` | Real-time event and delivery streaming |
| `dev` | Local development tunnel with signature verification |
| `export/import` | Backup and restore configuration |
| `migrate` | Instance-to-instance migration |
| `schema [resource]` | Runtime API schema introspection |
| `config set/get` | CLI configuration (`api_url`, `token`) |
| `health` | Check server connectivity and setup status |

## Links

- [GitHub](https://github.com/hookedge/hookflare) — source code, architecture, benchmarks
- [Agent Guide](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md) — rules, workflows, ID formats

## License

[Apache 2.0](https://github.com/hookedge/hookflare/blob/main/LICENSE)
