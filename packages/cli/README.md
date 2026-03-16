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

hookflare sits between webhook providers and your application. It accepts webhooks at 300+ Cloudflare edge locations, verifies signatures, and reliably delivers them to your API with automatic retries, circuit breaking, and a dead letter queue. Zero servers to manage.

## Quick Start

### 1. Deploy hookflare

If you haven't deployed hookflare yet, see the [deployment guide on GitHub](https://github.com/hookedge/hookflare#quick-start) — one-click deploy to Cloudflare or `npx wrangler deploy`.

### 2. Install the CLI

```bash
npm i -g hookflare
```

### 3. Connect to your instance

```bash
hookflare config set api_url https://your-hookflare.workers.dev
hookflare init    # creates your admin API key (stored automatically)
```

`init` calls the one-time bootstrap endpoint to create your first API key. The key is saved to `~/.hookflare/config.json`. All subsequent commands authenticate with it.

### 4. Set up Stripe webhooks

```bash
hookflare connect stripe \
  --secret whsec_your_secret \
  --to https://api.myapp.com/hooks \
  --events "payment_intent.*"
```

This creates a source (Stripe, with signature verification), a destination (your API), and a subscription (forwarding payment events). The output includes the webhook URL to paste into your Stripe Dashboard.

Omit `--events` to forward all events.

## What You Can Do

- **Connect providers** — Stripe, GitHub, Slack, Shopify, Vercel with one command
- **Inspect & replay events** — view delivery attempts, replay failed events
- **Monitor health** — circuit breaker status, DLQ inspection, real-time streaming
- **Manage routing** — fan-out one source to multiple destinations with event filters
- **Backup & migrate** — export/import configuration between instances

## Agent-Friendly

The CLI is built for AI agents. `--json` structured output, `--dry-run` safe validation, `--data` raw JSON input, and `hookflare schema` for runtime API discovery. See [AGENTS.md](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md) for the complete agent guide.

```bash
hookflare schema sources                             # discover fields
hookflare connect stripe --dry-run --json -d '{...}'  # validate
hookflare connect stripe --json -d '{...}'            # execute
```

## All Commands

| Category | Commands |
|---|---|
| **Setup** | `connect`, `init`, `config`, `health` |
| **Providers** | `providers ls`, `providers describe` |
| **Resources** | `sources`, `dest`, `subs` (create/ls/rm) |
| **Events** | `events ls/get/replay`, `tail` |
| **Operations** | `export`, `import`, `migrate`, `dev` |
| **Introspection** | `schema` |

Run `hookflare --help` or `hookflare <command> --help` for details.

## Links

- [GitHub](https://github.com/hookedge/hookflare) — source code, architecture, benchmarks
- [Agent Guide](https://github.com/hookedge/hookflare/blob/main/packages/cli/AGENTS.md) — rules, workflows, ID formats
- [Benchmarks](https://github.com/hookedge/hookflare/blob/main/BENCHMARKS.md) — P50 303ms, 0% error rate

## License

[Apache 2.0](https://github.com/hookedge/hookflare/blob/main/LICENSE)
