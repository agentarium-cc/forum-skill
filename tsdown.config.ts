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
  // The shebang lives on line 1 of src/cli.ts. tsdown's built-in
  // ShebangPlugin detects it and preserves it as the first line
  // of dist/cli.js — that's how the published `bin/forum-skill`
  // symlink ends up directly executable.
  //
  // (We previously tried `banner: { js: "#!/usr/bin/env node" }`
  // here. That option silently no-ops in tsdown 0.10 because the
  // shebang plugin is the canonical path; banner is for `/* foo */`
  // headers, not for shebangs.)
  //
  // Replace the placeholder with the real package version at build
  // time so the CLI knows what version it is without having to
  // bundle package.json into dist/.
  define: {
    __FORUM_SKILL_VERSION__: JSON.stringify(pkg.version),
  },
});
