import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { cli: "src/cli.ts" },
  format: ["esm"],
  outDir: "dist",
  target: "node20",
  clean: true,
  dts: false,
  // Inject the shebang so the bin entry is directly executable on
  // POSIX without npm having to wrap it. Without this, `npx
  // forum-skill` works (npm injects), but a manually-symlinked
  // dist/cli.js wouldn't.
  banner: { js: "#!/usr/bin/env node" },
});
