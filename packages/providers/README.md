# @hookpipe/providers

The webhook SDK for every provider. Verify signatures, parse events, validate payloads — with one unified API across Stripe, GitHub, Shopify, and 530+ event types. Zero dependencies on hookpipe runtime.

Production-proven: powers [hookpipe](https://github.com/hookpipe/hookpipe)'s own ingress verification.

## Install

```bash
npm install @hookpipe/providers
```

## Verify Signatures

```typescript
import { stripe, createVerifier } from '@hookpipe/providers';

const verify = createVerifier(stripe, { secret: 'whsec_xxx' });
const isValid = await verify(rawBody, requestHeaders);
```

Same API for every provider:

```typescript
import { github, createVerifier } from '@hookpipe/providers';

const verify = createVerifier(github, { secret: 'your_webhook_secret' });
const isValid = await verify(rawBody, requestHeaders);
```

Multi-secret providers (e.g. Taiwan payment gateways) work too:

```typescript
import { createVerifier } from '@hookpipe/providers';
import { ecpay } from 'hookpipe-provider-ecpay';

const verify = createVerifier(ecpay, { hash_key: '...', hash_iv: '...' });
```

Uses Web Crypto API — works in Node.js 18+, Cloudflare Workers, Deno, and Bun.

## Handle Webhooks

```typescript
import { stripe, createHandler } from '@hookpipe/providers';

const webhook = createHandler(stripe, { secret: 'whsec_xxx' });

app.post('/webhook', async (req, res) => {
  const result = await webhook.handle(req.body, req.headers);

  if (result.isChallenge) return res.json(result.challengeResponse);
  if (!result.verified) return res.status(401).end();

  console.log(result.eventType);  // "payment_intent.succeeded"
  console.log(result.eventId);    // "evt_1234"
  console.log(result.payload);    // parsed body
});
```

## Browse Event Catalogs

260 Stripe events, 277 GitHub events — generated from official SDK types. Always up-to-date.

```typescript
import { stripe } from '@hookpipe/providers';

// All 260 Stripe event types, with descriptions and categories
Object.keys(stripe.events).length;  // 260

// Filter by category
Object.entries(stripe.events)
  .filter(([_, e]) => typeof e !== 'string' && e.category === 'payments')
  .map(([name]) => name);
// → ['charge.captured', 'charge.expired', 'charge.failed', ...]
```

## Validate Payloads with Zod Schemas

```typescript
import { stripe } from '@hookpipe/providers';

const event = stripe.events['payment_intent.succeeded'];
if (typeof event !== 'string' && event.schema) {
  const result = event.schema.safeParse(body);
  if (!result.success) console.error('Invalid payload:', result.error);
}
```

Schemas are progressive — added per event as needed. PRs welcome.

## Built-in Providers

| Provider | Events | Verification | Schemas | Challenge | Presets |
|----------|--------|-------------|---------|-----------|---------|
| Stripe   | 260    | stripe-signature | 3 events | — | 5 |
| GitHub   | 277    | hmac-sha256 | 2 events | — | 5 |
| Slack    | 10     | slack-signature | — | ✓ | 3 |
| Shopify  | 17     | hmac-sha256 (base64) | — | — | 4 |
| Vercel   | 9      | hmac-sha1 | — | — | 2 |

Stripe and GitHub events are auto-generated from official SDK types (`stripe@20.4.1`, `@octokit/webhooks-types@7.6.1`). Regenerate with `pnpm gen`.

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

For custom verification schemes (e.g. HASH IV/KEY):

```typescript
export default defineProvider({
  id: 'ecpay',
  name: 'ECPay',
  verification: {
    type: 'custom',
    verify: async (secrets, body, headers) => {
      // Your verification logic using secrets.hash_key, secrets.hash_iv
      return isValid;
    },
  },
  secrets: {
    hash_key: { description: 'HashKey from ECPay dashboard' },
    hash_iv: { description: 'HashIV from ECPay dashboard' },
  },
  events: { 'payment.succeeded': 'Payment succeeded' },
});
```

See [DESIGN.md](./DESIGN.md) for the full architecture and provider tiers (built-in, official, community).

## API Reference

### Functions

- `createVerifier(provider, secrets, opts?)` → `VerifyFn` — create a signature verification function
- `createHandler(provider, secrets, opts?)` → `Handler` — create a full webhook handler (verify + parse + challenge)
- `defineProvider(def)` → `Provider` — define a new provider

### Data

- `builtinProviders` — `Record<string, Provider>` of all built-in providers
- `stripe`, `github`, `slack`, `shopify`, `vercel` — individual provider exports

### Types

- `Provider`, `ProviderDefinition` — provider interfaces
- `VerifyFn` — `(body: string, headers: Record<string, string>) => Promise<boolean>`
- `Handler`, `HandlerResult` — webhook handler interfaces
- `VerificationConfig` — signature verification configuration
- `EventCatalog`, `EventDefinition` — event type definitions (includes optional Zod `schema`)
- `ChallengeConfig`, `MockGenerators`, `Presets`, `NextSteps`, `SecretDefinition`

### Subpath Exports

- `@hookpipe/providers` — everything
- `@hookpipe/providers/define` — `defineProvider` + types only
- `@hookpipe/providers/verify` — `createVerifier` only
- `@hookpipe/providers/handler` — `createHandler` only

## CLI Integration

The [hookpipe CLI](https://www.npmjs.com/package/hookpipe) uses this package for provider-aware commands:

```bash
hookpipe providers ls                 # browse the event catalog
hookpipe providers describe stripe    # inspect events, verification, and presets
hookpipe connect stripe               # one-shot setup powered by provider knowledge
```

## License

Apache-2.0
