# @hookpipe/providers

Part of [hookpipe](https://github.com/hookpipe/hookpipe) — a free, open-source webhook gateway on Cloudflare Workers. This is the **knowledge layer**: it knows how providers sign webhooks, what events they send, and what those payloads look like.

Works standalone in any TypeScript project, or with the full hookpipe stack for automatic verification, reliable delivery, and retry management.

No other open-source webhook gateway ships typed Zod schemas for provider payloads.

## Install

```bash
npm install @hookpipe/providers
```

## Quick Start

### Parse event types

```typescript
import { stripe } from '@hookpipe/providers';

const eventType = stripe.parseEventType(body);
// → "payment_intent.succeeded"
```

### Validate payloads with Zod schemas

```typescript
import { stripe } from '@hookpipe/providers';

const event = stripe.events['payment_intent.succeeded'];
if (typeof event !== 'string' && event.schema) {
  const result = event.schema.safeParse(body);
  if (!result.success) console.error('Invalid payload:', result.error);
}
```

### Type-safe handler

```typescript
import { z } from 'zod';
import { stripe } from '@hookpipe/providers';

const def = stripe.events['payment_intent.succeeded'];
if (typeof def !== 'string' && def.schema) {
  type PaymentIntent = z.infer<typeof def.schema>;
  // → TypeScript infers the full payload type
}
```

### Get verification config

```typescript
import { github } from '@hookpipe/providers';

console.log(github.verification);
// → { header: 'x-hub-signature-256', algorithm: 'hmac-sha256' }
```

### Browse event catalog

```typescript
import { stripe } from '@hookpipe/providers';

Object.entries(stripe.events)
  .filter(([_, e]) => typeof e !== 'string' && e.category === 'payments')
  .map(([name]) => name);
// → ['payment_intent.created', 'payment_intent.succeeded', ...]
```

## Built-in Providers

| Provider | Events | Verification | Schema | Challenge | Presets |
|----------|--------|-------------|--------|-----------|---------|
| Stripe   | 22     | stripe-signature | 3 events | — | 5 |
| GitHub   | 18     | hmac-sha256 | — | — | 5 |
| Slack    | 10     | slack-signature | — | ✓ | 3 |
| Shopify  | 17     | hmac-sha256 (base64) | — | — | 4 |
| Vercel   | 9      | hmac-sha1 | — | — | 2 |

Schemas are progressive — added per event as needed. PRs welcome.

## Create Your Own Provider

Minimum — 4 required fields:

```typescript
import { defineProvider } from '@hookpipe/providers/define';

export default defineProvider({
  id: 'linear',
  name: 'Linear',
  verification: { header: 'linear-signature', algorithm: 'hmac-sha256' },
  events: { 'Issue.create': 'New issue created' },
});
```

With schema:

```typescript
import { z } from 'zod';
import { defineProvider } from '@hookpipe/providers/define';

export default defineProvider({
  id: 'linear',
  name: 'Linear',
  verification: { header: 'linear-signature', algorithm: 'hmac-sha256' },
  events: {
    'Issue.create': {
      description: 'New issue created',
      category: 'issues',
      schema: z.object({
        action: z.literal('create'),
        type: z.literal('Issue'),
        data: z.object({
          id: z.string(),
          title: z.string(),
          state: z.object({ name: z.string() }).passthrough(),
        }).passthrough(),
      }),
    },
  },
});
```

See [DESIGN.md](./DESIGN.md) for the full architecture and provider ecosystem.

## What This Package Does NOT Include

- **Signature verification crypto** — use hookpipe runtime or implement yourself
- **HTTP handling** — no request/response logic
- **Queue/delivery logic** — no retries, no persistence

This is a **knowledge-only** package. It tells you *what* to verify and
*what* the payload looks like, not *how* to verify.

## API Reference

### Functions

- `defineProvider(def)` → `Provider` — create a typed provider definition

### Data

- `builtinProviders` — `Record<string, Provider>` of all built-in providers
- `stripe`, `github`, `slack`, `shopify`, `vercel` — individual provider exports

### Types

- `Provider`, `ProviderDefinition` — provider interfaces
- `VerificationConfig` — signature verification configuration
- `EventCatalog`, `EventDefinition` — event type definitions (includes optional `schema`)
- `ChallengeConfig` — challenge-response configuration
- `MockGenerators`, `Presets`, `NextSteps`, `SecretDefinition`

## Used by hookpipe CLI

The [hookpipe CLI](https://www.npmjs.com/package/hookpipe) uses this package for provider-aware commands:

- `hookpipe providers ls` — browse the event catalog
- `hookpipe providers describe stripe` — inspect events, verification, and presets
- `hookpipe connect stripe` — one-shot setup powered by provider knowledge

## License

Apache-2.0
