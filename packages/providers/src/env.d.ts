/**
 * Minimal Web API type declarations.
 *
 * These APIs are available in all target runtimes:
 * Cloudflare Workers, Node.js 18+, Deno, Bun.
 */

// --- Text encoding ---

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

// --- Base64 ---

declare function btoa(data: string): string;

// --- Web Crypto ---

interface HmacImportParams {
  name: "HMAC";
  hash: string | { name: string };
}

type KeyUsage = "sign" | "verify";

interface CryptoKey {
  readonly type: string;
}

interface SubtleCrypto {
  importKey(
    format: "raw",
    keyData: BufferSource,
    algorithm: HmacImportParams,
    extractable: boolean,
    keyUsages: KeyUsage[],
  ): Promise<CryptoKey>;
  sign(
    algorithm: string,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer>;
}

declare const crypto: {
  readonly subtle: SubtleCrypto;
};
