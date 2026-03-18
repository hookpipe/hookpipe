import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  // Bundle everything so the published package is self-contained
  noExternal: ["@hookpipe/shared", "@hookpipe/providers"],
});
