/**
 * Destination URL validation — SSRF protection.
 *
 * Blocks requests to:
 * - Private/internal IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x)
 * - localhost and common local hostnames
 * - Non-HTTPS URLs (configurable)
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "0.0.0.0",
  "[::1]",
  "metadata.google.internal",
  "metadata.google.com",
]);

/**
 * Validate a destination URL for SSRF protection.
 * Returns null if valid, or an error message string if blocked.
 */
export function validateDestinationUrl(
  url: string,
  opts?: { allowHttp?: boolean },
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "Invalid URL";
  }

  // Protocol check
  if (!opts?.allowHttp && parsed.protocol === "http:") {
    return "Only HTTPS URLs are allowed for destinations. Set allowHttp to override.";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `Unsupported protocol: ${parsed.protocol}`;
  }

  // Blocked hostnames
  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return `Blocked hostname: ${hostname}`;
  }

  // Block private/internal IPs
  if (isPrivateIp(hostname)) {
    return `Blocked private IP: ${hostname}`;
  }

  return null;
}

function isPrivateIp(hostname: string): boolean {
  // IPv4 patterns
  const parts = hostname.split(".");
  if (parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p))) {
    const [a, b] = parts.map(Number);

    // 127.0.0.0/8 — loopback
    if (a === 127) return true;

    // 10.0.0.0/8 — private
    if (a === 10) return true;

    // 172.16.0.0/12 — private
    if (a === 172 && b >= 16 && b <= 31) return true;

    // 192.168.0.0/16 — private
    if (a === 192 && b === 168) return true;

    // 169.254.0.0/16 — link-local (AWS metadata etc.)
    if (a === 169 && b === 254) return true;

    // 0.0.0.0
    if (a === 0) return true;
  }

  // IPv6 loopback
  if (hostname === "::1" || hostname === "[::1]") return true;

  return false;
}
