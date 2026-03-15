/**
 * Input parsing and hardening for agent-generated inputs.
 *
 * Agents hallucinate. Build like it.
 * - Reject control characters
 * - Reject path traversals
 * - Reject double-encoded strings
 */

const CONTROL_CHAR_RE = /[\x00-\x1f]/;
const PATH_TRAVERSAL_RE = /\.\.\//;
const DOUBLE_ENCODE_RE = /%25/;

/**
 * Parse --data JSON flag. Returns parsed object or null if not provided.
 * Validates against adversarial patterns.
 */
export function parseJsonData(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) return null;

  validateInput(raw);

  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("--data must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in --data: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Validate a string input against adversarial patterns.
 */
export function validateInput(value: string): void {
  if (CONTROL_CHAR_RE.test(value)) {
    throw new Error("Input contains control characters");
  }
  if (PATH_TRAVERSAL_RE.test(value)) {
    throw new Error("Input contains path traversal");
  }
  if (DOUBLE_ENCODE_RE.test(value)) {
    throw new Error("Input contains double-encoded characters");
  }
}

/**
 * Validate a resource ID (no query params, no fragments).
 */
export function validateResourceId(id: string): void {
  validateInput(id);
  if (id.includes("?") || id.includes("#")) {
    throw new Error("Resource ID contains invalid characters (? or #)");
  }
}
