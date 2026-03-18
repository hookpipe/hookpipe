import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  api_url: string;
  token?: string;
}

const CONFIG_DIR = join(homedir(), ".hookpipe");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  api_url: "http://localhost:8787",
};

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULT_CONFIG };
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Partial<Config>): Config {
  const current = loadConfig();
  const merged = { ...current, ...config };
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
