# hookpipe Providers — Design Document

## What is a Provider?

A provider is a **static, read-only knowledge module** about a webhook sender. It tells hookpipe how to verify, parse, and understand webhooks from a specific service.

Providers are to hookpipe what providers are to Terraform — pluggable, typed, and community-extensible. The core engine doesn't need to know about Stripe or GitHub; the provider encapsulates that knowledge.

## Design Principles

- **Optional everything.** The minimum viable provider is `id`, `verification`, and `events`. Every other capability is opt-in.
- **Knowledge, not behavior.** A provider describes *what* a service does, not *how* hookpipe should process it. The core engine owns all processing logic.
- **One file, one provider.** Contributing a new provider should take minutes, not hours. No complex build steps, no framework boilerplate.
- **Progressive capability.** Providers can start simple and gain capabilities over time without breaking changes.

## Capabilities

Providers can declare the following capabilities. Each is independent and optional.

### MVP Capabilities

#### `secrets` — Credential Definition

Declare what credentials the provider requires. Most providers need a single signing secret, but some require multiple credentials (e.g., a key + IV pair for AES encryption, or a certificate for JWS verification).

```typescript
// Single secret (default — no need to declare explicitly)
// hookpipe connect stripe --secret whsec_xxx

// Multiple secrets
secrets: {
  api_key: { description: 'API key for payload decryption' },
  api_iv: { description: 'Initialization vector for AES decryption' },
}
// hookpipe connect my-psp --secret api_key=xxx --secret api_iv=yyy

// Certificate-based
secrets: {
  root_cert: { description: 'Root CA certificate (PEM)', required: false },
}
```

When `secrets` is not declared, the provider accepts a single `--secret` string (covers Stripe, GitHub, and most HMAC providers).

#### `verify` — Signature Verification

How to validate that an incoming webhook is authentic.

```typescript
// Built-in verifiers (handled by hookpipe core)
verification: {
  type: 'stripe-signature',
  header: 'stripe-signature',
}

// Generic HMAC
verification: {
  header: 'x-hub-signature-256',
  algorithm: 'hmac-sha256',
  encoding: 'hex',               // or 'base64' for Shopify
}

// Custom verification (for non-HMAC providers)
verification: {
  type: 'custom',
  verify: async (secrets, body, headers) => {
    // Full control — use any verification logic
    // Return true if authentic, false if not
    return true;
  },
}
```

The `custom` type receives the full `secrets` object, enabling verification methods beyond HMAC: RSA signatures, certificate chains, AES integrity checks, or callback-based verification.

#### `decode` — Payload Decryption / Preprocessing

Some providers send encrypted, signed, or encoded payloads that must be decoded before hookpipe can read, store, or forward them. `decode` runs after `verify` and before everything else in the pipeline.

```
Pipeline with decode:
  receive → verify → [decode] → parse event type → store → forward
                       ↑
              encrypted payload → readable JSON
```

```typescript
// AES-encrypted payload (common in payment gateways)
decode: async (secrets, body, headers) => {
  const encrypted = JSON.parse(body).encrypted_data;
  return JSON.parse(aesDecrypt(encrypted, secrets.api_key, secrets.api_iv));
},

// JWS/JWT signed payload (Apple App Store)
decode: async (secrets, body, headers) => {
  const { signedPayload } = JSON.parse(body);
  const decoded = verifyAndDecodeJWS(signedPayload, secrets.root_cert);
  return decoded;
},
```

When `decode` is not declared, hookpipe treats the raw body as the payload (covers Stripe, GitHub, and any provider that sends plaintext JSON).

**This capability is what distinguishes hookpipe from webhook tools that only support HMAC signatures.** It enables integration with payment gateways, enterprise systems, and regional providers that use encryption or signed tokens.

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

How to extract the event type and ID from the payload. When `decode` is declared, `parse` receives the decoded output, not the raw body.

```typescript
parseEventType: (body) => body.type,       // Stripe (plaintext)
parseEventId: (body) => body.id,

// Apple App Store (after decode)
parseEventType: (decoded) => decoded.notificationType,  // e.g., 'DID_RENEW'
parseEventId: (decoded) => decoded.notificationUUID,
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

Tell hookpipe which field uniquely identifies an event for deduplication.

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
import { defineProvider } from 'hookpipe/provider';

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

Three fields. One file. Publishable to npm as `hookpipe-provider-linear`.

## Full Provider Example (Plaintext — Stripe)

```typescript
import { defineProvider } from 'hookpipe/provider';
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

## Full Provider Example (Encrypted / Signed — Apple App Store)

Apple App Store Server Notifications v2 sends a JWS (JSON Web Signature) payload — the raw body is a signed JWT, not readable JSON. The provider must decode it before hookpipe can process it.

```typescript
import { defineProvider } from 'hookpipe/provider';

export default defineProvider({
  id: 'apple-app-store',
  name: 'Apple App Store',
  website: 'https://developer.apple.com',
  dashboardUrl: 'https://appstoreconnect.apple.com',

  secrets: {
    root_cert: {
      description: 'Apple Root CA certificate (PEM) for JWS verification. Optional — defaults to Apple production cert.',
      required: false,
    },
  },

  verification: {
    type: 'custom',
    verify: async (secrets, body, headers) => {
      // Apple signs the payload as a JWS — verification is part of decoding
      // We verify the certificate chain in decode(), so verify() is a pass-through
      return true;
    },
  },

  decode: async (secrets, body) => {
    const { signedPayload } = JSON.parse(body);
    // 1. Decode the JWS header to get the x5c certificate chain
    // 2. Verify the chain against Apple's root CA
    // 3. Verify the JWS signature using the leaf certificate
    // 4. Return the decoded payload
    const decoded = verifyAndDecodeAppleJWS(signedPayload, secrets.root_cert);
    return decoded;
  },

  parseEventType: (decoded) => decoded.notificationType,
  parseEventId: (decoded) => decoded.notificationUUID,

  events: {
    'DID_RENEW': 'Subscription successfully renewed',
    'DID_CHANGE_RENEWAL_STATUS': 'User changed subscription auto-renew status',
    'DID_FAIL_TO_RENEW': 'Subscription failed to renew (billing issue)',
    'EXPIRED': 'Subscription expired',
    'REFUND': 'Apple refunded a transaction',
    'SUBSCRIBED': 'User subscribed for the first time or re-subscribed',
    'CONSUMPTION_REQUEST': 'Apple requests consumption info for a refund decision',
    'GRACE_PERIOD_EXPIRED': 'Grace period for billing retry ended',
    'OFFER_REDEEMED': 'User redeemed a promotional offer',
    'RENEWAL_EXTENDED': 'Subscription renewal date was extended',
    'REVOKE': 'Family Sharing user lost access',
    'TEST': 'Sandbox test notification',
  },

  presets: {
    billing: ['DID_RENEW', 'DID_FAIL_TO_RENEW', 'EXPIRED', 'GRACE_PERIOD_EXPIRED'],
    access: ['SUBSCRIBED', 'REVOKE', 'REFUND', 'DID_CHANGE_RENEWAL_STATUS'],
    all: ['*'],
  },

  nextSteps: {
    dashboard: 'https://appstoreconnect.apple.com',
    instruction: 'Go to App Store Connect → App → App Information → App Store Server Notifications, paste the webhook URL, and select Version 2.',
  },
});
```

This example demonstrates the `secrets` + `decode` capabilities. The same pattern applies to:

- **Payment gateways** that encrypt notification payloads with AES (using a key + IV pair)
- **Enterprise platforms** that wrap payloads in signed JWTs or JWS tokens
- **Legacy systems** that use RSA signatures instead of HMAC shared secrets
- **Regional payment processors** that use form-encoded encrypted fields rather than JSON

The `decode` capability ensures hookpipe is not limited to HMAC-signing providers. Any service that requires decryption, JWT decoding, or payload transformation before the data is usable can be supported through a provider.

## Package Structure

```
hookpipe/
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

## Provider Ecosystem

### Three tiers

| Tier | Package naming | Maintained by | Example |
|---|---|---|---|
| **Built-in** | `hookpipe/providers` | hookpipe team | Stripe, GitHub, Slack |
| **Official** | `@hookpipe/provider-<name>` | hookpipe org | Linear, Clerk |
| **Community** | `hookpipe-provider-<name>` | Anyone | Any service |

Community providers can be promoted to Official when they are stable, tested, and actively maintained.

### Using providers

```bash
# Built-in — just works
hookpipe connect stripe --secret whsec_xxx --to https://...

# npm package (published)
hookpipe connect newebpay --provider hookpipe-provider-newebpay --secret hash_key=xxx ...

# GitHub repo (not published to npm — lowest barrier)
hookpipe connect newebpay --provider github:linyiru/hookpipe-provider-newebpay --secret hash_key=xxx ...

# Local path (during development)
hookpipe connect newebpay --provider ./my-providers/newebpay --secret hash_key=xxx ...
```

The `--provider` flag accepts three source types:
- **npm package name** — resolved via npm registry
- **`github:owner/repo`** — resolved directly from GitHub (no npm publish required)
- **Local path** (`./` or `/`) — for development and testing

GitHub-based providers have the lowest contribution barrier: fork the template, edit one file, push. No npm account needed.

### Importing in code (SDK usage)

```typescript
// Built-in
import { stripe } from 'hookpipe/providers';

// Official (separate package)
import { linear } from '@hookpipe/provider-linear';

// Community (npm or GitHub)
import { custom } from 'hookpipe-provider-mycrm';
```

## Contributing a Provider

### Quickest path (< 10 minutes)

1. Fork [`hookpipe/hookpipe-provider-template`](https://github.com/hookpipe/hookpipe-provider-template)
2. Edit `src/index.ts` — fill in `id`, `verification`, `events`
3. Push to GitHub
4. Share: `hookpipe connect my-service --provider github:yourname/hookpipe-provider-my-service`

No npm account, no publish step, no review process.

### Full contribution path

1. Create a repo from the template
2. Define `id`, `verification`, and `events` (minimum)
3. Add `decode` if the provider uses encrypted payloads
4. Add `mock` generators if possible (greatly improves DX)
5. Add tests
6. Publish to npm as `hookpipe-provider-<name>`
7. Submit a PR to add your provider to the [community providers list](https://github.com/hookpipe/hookpipe#community-providers) in the README

See the [minimal example](#minimal-provider-example) above — it's three fields and one file.
