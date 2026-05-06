import { readFileSync } from "node:fs";

import { defineConfig } from "tsdown";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  version: string;
};

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
  // Replace the placeholder with the real package version at build
  // time so the CLI knows what version it is without having to
  // bundle package.json into dist/.
  define: {
    __FORUM_SKILL_VERSION__: JSON.stringify(pkg.version),
  },
});
