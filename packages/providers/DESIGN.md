# hookflare Providers — Design Document

## What is a Provider?

A provider is a **static, read-only knowledge module** about a webhook sender. It tells hookflare how to verify, parse, and understand webhooks from a specific service.

Providers are to hookflare what providers are to Terraform — pluggable, typed, and community-extensible. The core engine doesn't need to know about Stripe or GitHub; the provider encapsulates that knowledge.

## Design Principles

- **Optional everything.** The minimum viable provider is `id`, `verification`, and `events`. Every other capability is opt-in.
- **Knowledge, not behavior.** A provider describes *what* a service does, not *how* hookflare should process it. The core engine owns all processing logic.
- **One file, one provider.** Contributing a new provider should take minutes, not hours. No complex build steps, no framework boilerplate.
- **Progressive capability.** Providers can start simple and gain capabilities over time without breaking changes.

## Capabilities

Providers can declare the following capabilities. Each is independent and optional.

### MVP Capabilities

#### `verify` — Signature Verification

How to validate that an incoming webhook is authentic.

```typescript
verification: {
  type: 'stripe-signature',      // built-in verifier
  header: 'stripe-signature',
}
// or generic HMAC:
verification: {
  header: 'x-hub-signature-256',
  algorithm: 'hmac-sha256',
  encoding: 'hex',               // or 'base64' for Shopify
}
```

#### `events` — Event Type Catalog

The known event types this provider can send, with descriptions.

```typescript
events: {
  'payment_intent.succeeded': 'Payment completed successfully',
  'customer.subscription.deleted': {
    description: 'Subscription cancelled',
    category: 'billing',
  },
}
```

#### `parse` — Event Extraction

How to extract the event type and ID from a raw payload.

```typescript
parseEventType: (body) => body.type,       // Stripe
parseEventId: (body) => body.id,
```

#### `challenge` — URL Verification

Some providers (Slack, Discord) send a challenge request when you register a webhook URL. The provider must respond immediately — this cannot go through the normal queue.

```typescript
challenge: {
  detect: (body) => body.type === 'url_verification',
  respond: (body) => ({ challenge: body.challenge }),
}
```

Without this capability, Slack and Discord webhooks cannot be configured at all.

### V1 Capabilities

#### `mock` — Generate Fake Events

Produce realistic fake webhook events for development and testing. No external service needed.

```typescript
mock: {
  'payment_intent.succeeded': () => ({
    id: `evt_mock_${randomId()}`,
    type: 'payment_intent.succeeded',
    data: { object: { amount: 4999, currency: 'usd' } },
    livemode: false,
    created: Math.floor(Date.now() / 1000),
  }),
}
```

Use cases:
- Local development without real Stripe/GitHub accounts
- CI/CD pipeline testing
- AI agent self-verification after setup
- Demos and documentation

#### `schema` — Payload Schemas

Zod schemas for event payloads, enabling type-safe handlers and runtime validation.

```typescript
events: {
  'payment_intent.succeeded': {
    description: 'Payment completed',
    schema: z.object({
      id: z.string(),
      amount: z.number(),
      currency: z.string(),
    }),
  },
}
```

### V2 Capabilities

#### `normalize` — Payload Normalization

Transform provider-specific payloads into a unified format, so downstream handlers don't need to understand each provider's structure.

```typescript
normalize: (body) => ({
  provider: 'stripe',
  eventType: body.type,
  eventId: body.id,
  timestamp: new Date(body.created * 1000),
  data: body.data.object,  // unwrap Stripe's data.object wrapper
})
```

#### `idempotencyKey` — Deduplication Hint

Tell hookflare which field uniquely identifies an event for deduplication.

```typescript
idempotencyKey: {
  fromBody: (body) => body.id,                              // Stripe
  fromHeaders: (headers) => headers['x-github-delivery'],   // GitHub
}
```

### V3 Capabilities

#### `record` — VCR Recording

Capture real webhook traffic for test fixture generation. Requires sanitization for PII.

#### `testMode` — Environment Detection

Detect whether an event is from a test/sandbox or production environment.

```typescript
testMode: {
  detect: (body) => body.livemode === false,
}
```

#### `send` — Outbound Delivery

Format and send requests to the provider's API (outbound webhooks).

## Minimal Provider Example

```typescript
import { defineProvider } from 'hookflare/provider';

export default defineProvider({
  id: 'linear',
  name: 'Linear',
  verification: { header: 'linear-signature', algorithm: 'hmac-sha256' },
  events: {
    'Issue.create': 'New issue created',
    'Issue.update': 'Issue updated',
  },
});
```

Three fields. One file. Publishable to npm as `hookflare-provider-linear`.

## Full Provider Example

```typescript
import { defineProvider } from 'hookflare/provider';
import { z } from 'zod';

export default defineProvider({
  id: 'stripe',
  name: 'Stripe',
  website: 'https://stripe.com',
  dashboardUrl: 'https://dashboard.stripe.com/webhooks',

  verification: {
    type: 'stripe-signature',
    header: 'stripe-signature',
  },

  parseEventType: (body) => body.type,
  parseEventId: (body) => body.id,

  challenge: undefined,  // Stripe doesn't use challenge

  events: {
    'payment_intent.succeeded': {
      description: 'Payment completed successfully',
      category: 'payments',
      schema: z.object({
        id: z.string(),
        amount: z.number(),
        currency: z.string(),
        customer: z.string().nullable(),
      }),
    },
    // ... more events
  },

  mock: {
    'payment_intent.succeeded': () => ({
      id: `evt_mock_${Date.now()}`,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: `pi_mock_${Date.now()}`,
          amount: 4999,
          currency: 'usd',
          status: 'succeeded',
          customer: `cus_mock_${Date.now()}`,
        },
      },
      livemode: false,
      created: Math.floor(Date.now() / 1000),
    }),
  },

  presets: {
    payments: ['payment_intent.*', 'charge.*'],
    billing: ['customer.subscription.*', 'invoice.*'],
    all: ['*'],
  },

  nextSteps: {
    dashboard: 'https://dashboard.stripe.com/webhooks',
    instruction: 'Add the webhook URL as an endpoint in Stripe Dashboard → Developers → Webhooks',
  },
});
```

## Package Structure

```
hookflare/
├── packages/
│   ├── providers/               # Built-in providers
│   │   ├── DESIGN.md            # This file
│   │   ├── src/
│   │   │   ├── define.ts        # defineProvider() interface
│   │   │   ├── stripe/index.ts
│   │   │   ├── github/index.ts
│   │   │   ├── slack/index.ts
│   │   │   ├── shopify/index.ts
│   │   │   └── vercel/index.ts
│   │   └── package.json
```

## Publishing

- Built-in providers ship with `hookflare/providers`
- Official providers publish as `@hookflare/provider-<name>`
- Community providers follow `hookflare-provider-<name>` convention

```typescript
// Built-in
import { stripe } from 'hookflare/providers';

// Official (separate package)
import { linear } from '@hookflare/provider-linear';

// Community
import { custom } from 'hookflare-provider-mycrm';
```

## Contributing a Provider

1. Create a file with `defineProvider()`
2. Define `id`, `verification`, and `events` (minimum)
3. Add `mock` generators if possible (greatly improves DX)
4. Publish to npm or submit a PR to the hookflare repo

See the [minimal example](#minimal-provider-example) above — it's three fields and one file.
