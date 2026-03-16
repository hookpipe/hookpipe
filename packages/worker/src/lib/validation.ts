import { z } from "zod";
import type { Context } from "hono";
import { validateDestinationUrl } from "./url-validation";

// --- Sources ---

export const createSourceSchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  provider: z.string().max(50).optional(),
  verification: z
    .object({
      type: z.string().min(1),
      secret: z.string().min(1),
    })
    .optional(),
});

export const updateSourceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  provider: z.string().max(50).nullish(),
  verification: z
    .object({
      type: z.string().min(1),
      secret: z.string().min(1),
    })
    .nullish(),
});

// --- Destinations ---

export const retryPolicySchema = z.object({
  strategy: z.enum(["exponential", "linear", "fixed"]).default("exponential"),
  max_retries: z.number().int().min(0).max(50).default(10),
  interval_ms: z.number().int().min(100).max(86400000).default(60000),
  max_interval_ms: z.number().int().min(100).max(604800000).default(86400000),
  timeout_ms: z.number().int().min(1000).max(300000).default(30000),
  on_status: z.array(z.string()).optional(),
});

const safeUrl = z.string().url("url must be a valid URL").refine(
  (url: string) => validateDestinationUrl(url) === null,
  { message: "URL blocked by SSRF protection (private IP, localhost, or non-HTTPS)" },
);

export const createDestinationSchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  url: safeUrl,
  retry_policy: retryPolicySchema.optional(),
});

export const updateDestinationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: safeUrl.optional(),
  retry_policy: retryPolicySchema.partial().optional(),
});

// --- Subscriptions ---

export const createSubscriptionSchema = z.object({
  source_id: z.string().min(1, "source_id is required"),
  destination_id: z.string().min(1, "destination_id is required"),
  event_types: z.array(z.string()).default(["*"]),
});

// --- API Keys ---

export const createKeySchema = z.object({
  name: z.string().min(1, "name is required").max(100),
  scopes: z.array(z.string()).default(["admin"]),
  expires_at: z.string().datetime().optional(),
});

// --- Import ---

// Import schema is lenient — accepts data from any hookflare version
export const importDataSchema = z.object({
  version: z.literal("1"),
  exported_at: z.string().optional(),
  instance_url: z.string().optional(),
  sources: z.array(z.object({
    id: z.string(),
    name: z.string(),
    provider: z.string().nullable().optional(),
    verification_type: z.string().nullable().optional(),
    verification_secret: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).default([]),
  destinations: z.array(z.object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    timeout_ms: z.number().optional(),
    retry_strategy: z.enum(["exponential", "linear", "fixed"]).optional(),
    max_retries: z.number().optional(),
    retry_interval_ms: z.number().optional(),
    retry_max_interval_ms: z.number().optional(),
    retry_on_status: z.string().nullable().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })).default([]),
  subscriptions: z.array(z.object({
    id: z.string(),
    source_id: z.string(),
    destination_id: z.string(),
    event_types: z.string().default('["*"]'),
    enabled: z.number().default(1),
    created_at: z.string().optional(),
  })).default([]),
});

// --- Helper ---

/**
 * Parse and validate request body with a Zod schema.
 * Returns structured validation errors on failure.
 */
export async function parseBody<T>(
  c: Context,
  schema: z.ZodType<T>,
): Promise<T> {
  const raw = await c.req.json().catch(() => null);
  if (raw === null) {
    throw new ValidationError("Invalid JSON body");
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join(".") + ": " : "";
    throw new ValidationError(`${path}${issue.message}`, result.error.issues);
  }

  return result.data;
}

export class ValidationError extends Error {
  public readonly issues: z.ZodIssue[] | undefined;

  constructor(message: string, issues?: z.ZodIssue[]) {
    super(message);
    this.name = "ValidationError";
    this.issues = issues;
  }
}
