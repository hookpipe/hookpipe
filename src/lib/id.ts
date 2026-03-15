/**
 * Generate a prefixed unique ID using crypto.randomUUID().
 * Format: {prefix}_{uuid-without-dashes}
 */
export function generateId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid}`;
}
