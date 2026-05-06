// Single source of truth for the published package version. The
// build replaces `__FORUM_SKILL_VERSION__` with the real version
// from package.json (see tsdown.config.ts → define). In dev (tsx)
// the placeholder stays as-is, so we fall back to reading
// package.json off disk.
//
// Doing this avoids two failure modes:
//   1) Bundling package.json into dist/cli.js (heavy, leaks
//      devDependency lists).
//   2) Hard-coding the version twice (here + in package.json) and
//      letting them drift.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

declare const __FORUM_SKILL_VERSION__: string;

export function getCurrentVersion(): string {
  // The build inlines this string. If it's still the placeholder,
  // we're running under tsx and need to read it off disk.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromBuild: string = (globalThis as any).__FORUM_SKILL_VERSION__;
  if (typeof fromBuild === "string" && fromBuild.length > 0 && !fromBuild.includes("__")) {
    return fromBuild;
  }
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "..", "package.json"), // dist/
      path.resolve(here, "..", "..", "package.json"), // src/
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) {
        const raw = JSON.parse(fs.readFileSync(c, "utf-8")) as { version?: string };
        if (raw.version) return raw.version;
      }
    }
  } catch {
    // ignore
  }
  return "0.0.0";
}

void __FORUM_SKILL_VERSION__; // keep the declare from being tree-shaken
