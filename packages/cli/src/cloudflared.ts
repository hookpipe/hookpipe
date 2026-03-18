import { existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import { execSync, spawn, type ChildProcess } from "node:child_process";

const HOOKPIPE_DIR = join(homedir(), ".hookpipe", "bin");
const BINARY_NAME = platform() === "win32" ? "cloudflared.exe" : "cloudflared";
const LOCAL_PATH = join(HOOKPIPE_DIR, BINARY_NAME);

/**
 * Find or install cloudflared binary.
 * Priority: PATH → ~/.hookpipe/bin → auto-download
 */
export async function ensureCloudflared(): Promise<string> {
  // 1. Check PATH
  try {
    const systemPath = execSync("which cloudflared", { encoding: "utf-8" }).trim();
    if (systemPath) return systemPath;
  } catch {
    // not in PATH
  }

  // 2. Check local install
  if (existsSync(LOCAL_PATH)) return LOCAL_PATH;

  // 3. Download
  console.log("cloudflared not found. Downloading...");
  await downloadCloudflared();
  return LOCAL_PATH;
}

async function downloadCloudflared(): Promise<void> {
  mkdirSync(HOOKPIPE_DIR, { recursive: true });

  const os = platform();
  const cpu = arch();
  const url = getDownloadUrl(os, cpu);

  if (!url) {
    throw new Error(`Unsupported platform: ${os}/${cpu}. Install cloudflared manually: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`);
  }

  if (url.endsWith(".tgz")) {
    execSync(`curl -sL "${url}" | tar -xz -C "${HOOKPIPE_DIR}" cloudflared`, { stdio: "inherit" });
  } else {
    execSync(`curl -sL -o "${LOCAL_PATH}" "${url}"`, { stdio: "inherit" });
  }

  chmodSync(LOCAL_PATH, 0o755);
  console.log(`✓ cloudflared installed to ${LOCAL_PATH}`);
}

function getDownloadUrl(os: string, cpu: string): string | null {
  const base = "https://github.com/cloudflare/cloudflared/releases/latest/download";

  if (os === "darwin") {
    return cpu === "arm64"
      ? `${base}/cloudflared-darwin-arm64.tgz`
      : `${base}/cloudflared-darwin-amd64.tgz`;
  }

  if (os === "linux") {
    if (cpu === "x64" || cpu === "amd64") return `${base}/cloudflared-linux-amd64`;
    if (cpu === "arm64") return `${base}/cloudflared-linux-arm64`;
    if (cpu === "arm") return `${base}/cloudflared-linux-arm`;
    return null;
  }

  if (os === "win32") {
    return cpu === "x64"
      ? `${base}/cloudflared-windows-amd64.exe`
      : `${base}/cloudflared-windows-386.exe`;
  }

  return null;
}

/**
 * Start a quick tunnel and return the public URL.
 */
export function startTunnel(
  cloudflaredPath: string,
  localPort: number,
): { process: ChildProcess; urlPromise: Promise<string> } {
  const child = spawn(cloudflaredPath, ["tunnel", "--url", `http://localhost:${localPort}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const urlPromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Tunnel failed to start within 15 seconds")), 15000);

    const onData = (data: Buffer) => {
      const line = data.toString();
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    };

    child.stderr?.on("data", onData);
    child.stdout?.on("data", onData);

    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`cloudflared exited with code ${code}`));
      }
    });
  });

  return { process: child, urlPromise };
}
