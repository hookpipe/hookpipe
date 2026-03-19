/**
 * createVerifier — turn a provider definition into an actual verify function.
 *
 * ```typescript
 * import { stripe, createVerifier } from '@hookpipe/providers';
 * const verify = createVerifier(stripe, { secret: 'whsec_xxx' });
 * const isValid = await verify(rawBody, headers);
 * ```
 */

import type { Provider } from "./define";
import { verifyStripeSignature } from "./crypto/stripe";
import { verifySlackSignature } from "./crypto/slack";
import { verifyHmacSignature } from "./crypto/hmac";

export type VerifyFn = (
  body: string,
  headers: Record<string, string>,
) => Promise<boolean>;

export interface VerifierOptions {
  /** Timestamp tolerance in seconds (for Stripe/Slack). Default: 300 */
  toleranceSec?: number;
}

/**
 * Create a verification function from a provider definition and secrets.
 *
 * For single-secret providers (Stripe, GitHub, Shopify, Vercel):
 *   `createVerifier(stripe, { secret: 'whsec_xxx' })`
 *
 * For multi-secret providers (ECPay, NewebPay):
 *   `createVerifier(ecpay, { hash_key: '...', hash_iv: '...' })`
 */
export function createVerifier(
  provider: Provider,
  secrets: Record<string, string>,
  opts?: VerifierOptions,
): VerifyFn {
  const config = provider.verification;
  const toleranceSec = opts?.toleranceSec ?? 300;

  // Custom verification — delegate entirely to provider
  if ("type" in config && config.type === "custom") {
    return (body, headers) => config.verify(secrets, body, headers);
  }

  // Built-in: stripe-signature
  if ("type" in config && config.type === "stripe-signature") {
    return async (body, headers) => {
      const sig = headers[config.header];
      if (!sig) return false;
      return verifyStripeSignature(secrets.secret, body, sig, toleranceSec);
    };
  }

  // Built-in: slack-signature
  if ("type" in config && config.type === "slack-signature") {
    return async (body, headers) => {
      const sig = headers[config.header];
      const ts = headers["x-slack-request-timestamp"];
      if (!sig || !ts) return false;
      return verifySlackSignature(secrets.secret, body, sig, ts, toleranceSec);
    };
  }

  // Generic HMAC (GitHub, Shopify, Vercel, etc.)
  // At this point, config must be the HMAC variant (has algorithm + header)
  const hmacConfig = config as {
    header: string;
    algorithm: "hmac-sha256" | "hmac-sha1";
    encoding?: "hex" | "base64";
  };
  const algorithm = hmacConfig.algorithm === "hmac-sha1" ? "SHA-1" as const : "SHA-256" as const;
  const encoding = hmacConfig.encoding ?? "hex";
  return async (body, headers) => {
    const sig = headers[hmacConfig.header];
    if (!sig) return false;
    return verifyHmacSignature(algorithm, secrets.secret, body, sig, encoding);
  };
}
