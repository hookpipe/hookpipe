/**
 * Generate Stripe event type catalog from the official Stripe SDK.
 *
 * Reads Stripe.WebhookEndpointCreateParams.EnabledEvent union type
 * from the Stripe SDK .d.ts file and generates a complete event list
 * with auto-generated descriptions and categories.
 *
 * Usage: pnpm gen:stripe
 * Output: src/stripe/_generated-events.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- Find Stripe SDK types ---

function findStripeDts(): string {
  // Try direct node_modules first, then pnpm structure
  const candidates = [
    resolve(ROOT, "node_modules/stripe/types/WebhookEndpointsResource.d.ts"),
    resolve(ROOT, "../../node_modules/stripe/types/WebhookEndpointsResource.d.ts"),
  ];

  for (const candidate of candidates) {
    try {
      readFileSync(candidate, "utf-8");
      return candidate;
    } catch {
      continue;
    }
  }

  // pnpm: find via glob-like search
  const found = execSync(
    `find ${resolve(ROOT, "../../node_modules/.pnpm")} -path "*/stripe/types/WebhookEndpointsResource.d.ts" 2>/dev/null | head -1`,
    { encoding: "utf-8" },
  ).trim();

  if (!found) {
    throw new Error("Cannot find Stripe SDK types. Run: pnpm add -D stripe");
  }
  return found;
}

// --- Extract event types from .d.ts ---

function extractEventTypes(dtsContent: string): string[] {
  // Match the EnabledEvent union type — first occurrence
  const match = dtsContent.match(
    /type\s+EnabledEvent\s*=\s*([\s\S]*?)(?:;\s*$|\n\s{4}\})/m,
  );
  if (!match) {
    throw new Error("Cannot find EnabledEvent type in Stripe SDK");
  }

  const unionBlock = match[1];
  const events: string[] = [];
  const regex = /'\s*([a-z_]+(?:\.[a-z_*]+)*)\s*'/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(unionBlock)) !== null) {
    if (m[1] !== "*") {
      events.push(m[1]);
    }
  }

  if (events.length < 50) {
    throw new Error(
      `Only found ${events.length} Stripe events — expected 200+. SDK format may have changed.`,
    );
  }

  return events.sort();
}

// --- Auto-generate descriptions and categories ---

const CATEGORY_MAP: Record<string, string> = {
  account: "account",
  application_fee: "connect",
  balance: "balance",
  balance_settings: "balance",
  billing: "billing",
  billing_portal: "billing",
  capability: "connect",
  cash_balance: "balance",
  charge: "payments",
  checkout: "checkout",
  climate: "climate",
  coupon: "billing",
  credit_note: "billing",
  customer: "customers",
  customer_cash_balance_transaction: "customers",
  entitlements: "entitlements",
  file: "files",
  financial_connections: "financial_connections",
  identity: "identity",
  invoice: "billing",
  invoiceitem: "billing",
  issuing: "issuing",
  mandate: "payments",
  payment_intent: "payments",
  payment_link: "payments",
  payment_method: "payments",
  payout: "payouts",
  person: "connect",
  plan: "billing",
  price: "billing",
  product: "products",
  promotion_code: "billing",
  quote: "billing",
  radar: "fraud",
  refund: "payments",
  reporting: "reporting",
  review: "fraud",
  setup_intent: "payments",
  sigma: "reporting",
  source: "payments",
  subscription: "billing",
  subscription_schedule: "billing",
  tax: "tax",
  tax_rate: "tax",
  terminal: "terminal",
  test_helpers: "testing",
  topup: "balance",
  transfer: "connect",
  treasury: "treasury",
};

function categorize(event: string): string {
  // Try progressively shorter prefixes
  const parts = event.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(".");
    if (CATEGORY_MAP[prefix]) return CATEGORY_MAP[prefix];
  }
  if (CATEGORY_MAP[parts[0]]) return CATEGORY_MAP[parts[0]];
  return "other";
}

function humanize(event: string): string {
  return event
    .split(".")
    .map((part) =>
      part
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" "),
    )
    .join(" ");
}

// --- Generate output ---

function generate(): void {
  const dtsPath = findStripeDts();
  const dtsContent = readFileSync(dtsPath, "utf-8");
  const events = extractEventTypes(dtsContent);

  // Read stripe SDK version
  let stripeVersion = "unknown";
  try {
    const pkgPath = dtsPath.replace(/\/types\/.*$/, "/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    stripeVersion = pkg.version;
  } catch {
    // ignore
  }

  const lines: string[] = [
    "// AUTO-GENERATED — do not edit manually.",
    `// Source: stripe@${stripeVersion} WebhookEndpointCreateParams.EnabledEvent`,
    `// Generated: ${new Date().toISOString().split("T")[0]}`,
    "// Regenerate: pnpm gen:stripe",
    "",
    'import type { EventDefinition } from "../define";',
    "",
    "export const stripeEventTypes = [",
    ...events.map((e) => `  "${e}",`),
    "] as const;",
    "",
    "export type StripeEventType = (typeof stripeEventTypes)[number];",
    "",
    "/** Auto-generated base descriptions. Hand-curated entries in stripe/index.ts override these. */",
    "export const generatedStripeEvents: Record<StripeEventType, string | EventDefinition> = {",
    ...events.map(
      (e) => `  "${e}": { description: "${humanize(e)}", category: "${categorize(e)}" },`,
    ),
    "};",
    "",
  ];

  const outPath = resolve(ROOT, "src/stripe/_generated-events.ts");
  writeFileSync(outPath, lines.join("\n"), "utf-8");
  console.log(`✓ Generated ${events.length} Stripe events → src/stripe/_generated-events.ts`);
}

generate();
