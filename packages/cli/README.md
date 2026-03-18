# hookpipe

**Never miss a webhook.** CLI for [hookpipe](https://github.com/hookpipe/hookpipe) — open-source webhook infrastructure on Cloudflare Workers.

```bash
npm i -g hookpipe
```

## How it Works

```
Stripe/GitHub/Slack → hookpipe (Cloudflare edge) → your API
                      ├─ verify signature
                      ├─ queue durably
                      ├─ retry with backoff
                      └─ never lose an event
```

hookpipe sits between webhook providers and your application. It accepts webhooks at 300+ Cloudflare edge locations, verifies signatures, and reliably delivers them to your API with automatic retries, circuit breaking, and a dead letter queue. Zero servers to manage, zero idle cost.

**Why hookpipe?** Unlike SaaS webhook tools (Hookdeck, Svix), hookpipe runs on **your own** Cloudflare account — you own the data, pay Cloudflare directly ($0 on free tier for most workloads), and deploy in 30 seconds.

## Try it Locally (2 minutes)

```bash
# 1. Clone and start
git clone https://github.com/hookpipe/hookpipe.git && cd hookpipe
pnpm install && pnpm --filter @hookpipe/shared build && pnpm --filter @hookpipe/providers build
pnpm --filter @hookpipe/worker db:migrate:local
pnpm --filter @hookpipe/worker dev   # starts on http://localhost:8787

# 2. In another terminal — install CLI and bootstrap
npm i -g hookpipe
hookpipe config set api_url http://localhost:8787
hookpipe init

# 3. Create a Stripe webhook pipeline
hookpipe connect stripe --secret whsec_test --to https://httpbin.org/post

# 4. Send a test webhook
curl -X POST http://localhost:8787/webhooks/<source_id_from_output> \
  -H "Content-Type: application/json" \
  -d '{"type":"payment_intent.succeeded","data":{"amount":4999}}'

# 5. Check delivery
hookpipe events ls
```

## Quick Start (Production)

### 1. Deploy hookpipe

See the [deployment guide on GitHub](https://github.com/hookpipe/hookpipe#quick-start) — one-click deploy to Cloudflare or `npx wrangler deploy`.

### 2. Install the CLI and bootstrap

```bash
npm i -g hookpipe
hookpipe config set api_url https://your-hookpipe.workers.dev
hookpipe init    # creates your admin API key (stored automatically)
```

`init` calls the one-time bootstrap endpoint to create your first API key. The key is saved to `~/.hookpipe/config.json`. All subsequent commands authenticate with it. Running `init` again on an already-bootstrapped instance is a no-op.

### 3. Set up Stripe webhooks

```bash
hookpipe connect stripe \
  --secret whsec_your_secret \
  --to https://api.myapp.com/hooks \
  --events "payment_intent.*"
```

Output:

```
✓ Connected stripe → https://api.myapp.com/hooks

  Source:       src_a1b2c3 (stripe)
  Destination:  dst_d4e5f6 (my-app)
  Events:       payment_intent.*

  Webhook URL:
    https://your-hookpipe.workers.dev/webhooks/src_a1b2c3

  Register this URL with Stripe:
    CLI:       stripe webhook_endpoints create --url https://your-hookpipe.workers.dev/webhooks/src_a1b2c3
    Dashboard: https://dashboard.stripe.com/webhooks
               Add the webhook URL as an endpoint in Developers → Webhooks
    Docs:      https://docs.stripe.com/webhooks
```

Omit `--events` to forward all events. hookpipe forwards the original payload as-is to your destination with these headers added: `X-Hookpipe-Event-Id`, `X-Hookpipe-Delivery-Id`, `X-Hookpipe-Attempt`.

If delivery fails, hookpipe retries automatically with exponential backoff (up to 10 attempts over ~8 hours). Events that exhaust all retries are moved to a dead letter queue for manual replay. You can configure retry strategy (exponential/linear/fixed), max attempts, and which HTTP status codes trigger retries — per destination.

## What You Can Do

- **Connect providers** — Stripe, GitHub, Slack, Shopify, Vercel with one command
- **Inspect & replay events** — view delivery attempts, replay failed events
- **Monitor health** — circuit breaker status, DLQ inspection, real-time streaming with `hookpipe tail`
- **Manage routing** — fan-out one source to multiple destinations with event type filters
- **Backup & migrate** — export/import configuration, one-command instance-to-instance migration

## Agent-Friendly

The CLI is built for AI agents. See [AGENTS.md](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md) for the complete guide.

```bash
# Discover → Validate → Execute
hookpipe schema sources                              # discover fields at runtime
hookpipe connect stripe --dry-run --json -d '{...}'   # validate without creating
hookpipe connect stripe --json -d '{...}'             # execute, get JSON output
```

`--json` output example:

```json
{
  "data": {
    "source": { "id": "src_a1b2c3", "name": "stripe", "provider": "stripe" },
    "destination": { "id": "dst_d4e5f6", "url": "https://api.myapp.com/hooks" },
    "subscription": { "id": "sub_g7h8i9", "event_types": ["payment_intent.*"] },
    "webhook_url": "https://your-hookpipe.workers.dev/webhooks/src_a1b2c3"
  },
  "next_steps": {
    "cli": { "binary": "stripe", "args": ["webhook_endpoints", "create", "--url", "https://..."] },
    "dashboard": { "url": "https://dashboard.stripe.com/webhooks" },
    "docs_url": "https://docs.stripe.com/webhooks"
  }
}
```

Agents can use `next_steps.cli` to compose with provider CLIs. See [AGENTS.md](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md#composing-with-provider-clis) for examples.

Key flags: `--json` (structured output), `--dry-run` (safe validation), `-d/--data` (raw JSON input), `--fields` (limit output columns), `hookpipe schema` (API introspection).

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

- [GitHub](https://github.com/hookpipe/hookpipe) — source code, architecture, benchmarks
- [Agent Guide](https://github.com/hookpipe/hookpipe/blob/main/packages/cli/AGENTS.md) — rules, workflows, ID formats

## License

[Apache 2.0](https://github.com/hookpipe/hookpipe/blob/main/LICENSE)
