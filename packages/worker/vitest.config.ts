import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
    coverage: {
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // entry point is just wiring
    },
  },
});
