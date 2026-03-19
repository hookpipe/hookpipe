// Provider definition framework
export { defineProvider } from "./define";
export type {
  Provider,
  ProviderDefinition,
  VerificationConfig,
  EventCatalog,
  EventDefinition,
  ChallengeConfig,
  MockGenerators,
  Presets,
  NextSteps,
  SecretDefinition,
} from "./define";

// Verification & handling
export { createVerifier } from "./verifier";
export type { VerifyFn, VerifierOptions } from "./verifier";
export { createHandler } from "./handler";
export type { Handler, HandlerResult } from "./handler";

// Built-in providers
export { stripe } from "./stripe/index";
export { github } from "./github/index";
export { slack } from "./slack/index";
export { shopify } from "./shopify/index";
export { vercel } from "./vercel/index";

// Provider registry (all built-ins)
import { stripe } from "./stripe/index";
import { github } from "./github/index";
import { slack } from "./slack/index";
import { shopify } from "./shopify/index";
import { vercel } from "./vercel/index";
import type { Provider } from "./define";

export const builtinProviders: Record<string, Provider> = {
  stripe,
  github,
  slack,
  shopify,
  vercel,
};
