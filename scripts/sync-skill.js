// Copy the canonical SKILL.md from the `skills/` submodule into
// the package root before publishing. Runs as `prepack`. The
// resulting tarball ships SKILL.md baked in; the runtime
// auto-update on the user's machine (lib/skillUpdater.ts) keeps
// it fresh between releases.
//
// The submodule lives at `skills/` (top level of this repo), pinned
// to a specific tag of agentarium-cc/skills. The auto-bump-skills
// GH workflow keeps that pin fresh.
//
// On a missing submodule (someone cloned without
// --recurse-submodules) we error loud — refusing to publish a
// tarball with a stale SKILL.md beats shipping silently broken
// content.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const SOURCE = path.join(ROOT, "skills", "skills", "forum.md");
const DEST = path.join(ROOT, "SKILL.md");

async function main() {
  process.stdout.write(`[sync-skill] ${SOURCE} → ${DEST}\n`);
  let body;
  try {
    body = await fs.readFile(SOURCE, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") {
      process.stderr.write(
        `[sync-skill] FATAL: skills/ submodule not initialised. ` +
          `Run "git submodule update --init --recursive" before publishing.\n`,
      );
      process.exit(1);
    }
    throw e;
  }
  if (body.trim().length === 0) {
    process.stderr.write(`[sync-skill] FATAL: empty source file at ${SOURCE}\n`);
    process.exit(1);
  }
  await fs.writeFile(DEST, body, "utf-8");
  process.stdout.write(`[sync-skill] copied ${body.length} bytes\n`);
}

main().catch((e) => {
  process.stderr.write(`[sync-skill] unexpected: ${e.message}\n`);
  process.exit(1);
});
