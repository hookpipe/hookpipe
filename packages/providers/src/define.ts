/**
 * Provider definition interface.
 *
 * A provider is a static knowledge module about a webhook sender.
 * It describes how to verify, parse, and understand webhooks
 * from a specific service.
 *
 * Minimum: id + verification + events.
 * Everything else is optional.
 */

// --- Verification ---

export type BuiltinVerifierType = "stripe-signature" | "slack-signature";

export type VerificationConfig =
  | {
      /** Built-in verifier handled by hookpipe core */
      type: BuiltinVerifierType;
      header: string;
    }
  | {
      /** Generic HMAC verification */
      header: string;
      algorithm: "hmac-sha256" | "hmac-sha1";
      encoding?: "hex" | "base64";
    }
  | {
      /** Custom verification logic */
      type: "custom";
      verify: (
        secrets: Record<string, string>,
        body: string,
        headers: Record<string, string>,
      ) => Promise<boolean>;
    };

// --- Secrets ---

export interface SecretDefinition {
  description: string;
  required?: boolean; // default true
}

// --- Events ---

export interface EventDefinition {
  description: string;
  category?: string;
}

export type EventCatalog = Record<string, string | EventDefinition>;

// --- Challenge ---

export interface ChallengeConfig {
  detect: (body: Record<string, unknown>) => boolean;
  respond: (body: Record<string, unknown>) => unknown;
}

// --- Mock ---

export type MockGenerators = Record<string, () => unknown>;

// --- Presets ---

export type Presets = Record<string, string[]>;

// --- Next Steps ---

export interface ProviderCli {
  /** CLI binary name (e.g., "stripe", "gh", "vercel") */
  binary: string;
  /** Command args with {{webhook_url}} placeholder */
  args: string[];
  /** Install instruction (e.g., "brew install stripe/stripe-cli/stripe") */
  install?: string;
}

export interface NextSteps {
  /** Provider webhook dashboard URL */
  dashboard?: string;
  /** Human-readable instruction for dashboard setup */
  instruction?: string;
  /** Provider webhook documentation URL */
  docsUrl?: string;
  /** Provider CLI for automated webhook registration (null if no CLI available) */
  cli?: ProviderCli | null;
}

// --- Full Provider Definition ---

export interface ProviderDefinition {
  // Required
  id: string;
  name: string;
  verification: VerificationConfig;
  events: EventCatalog;

  // Optional — MVP
  website?: string;
  dashboardUrl?: string;
  secrets?: Record<string, SecretDefinition>;
  decode?: (
    secrets: Record<string, string>,
    body: string,
    headers: Record<string, string>,
  ) => Promise<unknown>;
  parseEventType?: (body: unknown, headers?: Record<string, string>) => string | null;
  parseEventId?: (body: unknown, headers?: Record<string, string>) => string | null;
  challenge?: ChallengeConfig;

  // Optional — V1
  mock?: MockGenerators;
  presets?: Presets;
  nextSteps?: NextSteps;
}

// --- Resolved Provider (output of defineProvider) ---

export interface Provider extends ProviderDefinition {
  readonly _brand: "hookpipe-provider";
}

/**
 * Define a hookpipe provider.
 *
 * ```typescript
 * import { defineProvider } from 'hookpipe/provider';
 *
 * export default defineProvider({
 *   id: 'linear',
 *   name: 'Linear',
 *   verification: { header: 'linear-signature', algorithm: 'hmac-sha256' },
 *   events: { 'Issue.create': 'New issue created' },
 * });
 * ```
 */
export function defineProvider(def: ProviderDefinition): Provider {
  return { ...def, _brand: "hookpipe-provider" as const };
}
