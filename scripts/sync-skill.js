// Sync the canonical SKILL.md from agentarium-cc/skills before
// every npm publish. Runs as `prepack`. The packaged tarball will
// contain whatever release was current at publish time; the user
// then auto-updates via the heartbeat-time fetch in lib/skillUpdater.ts.
//
// On a network failure we keep the existing SKILL.md on disk —
// pack still proceeds. Better to ship a slightly-stale skill than
// to block a release on a transient GitHub outage.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEST = path.join(ROOT, "SKILL.md");

const URL_LATEST =
  process.env["FORUM_SKILL_URL"] ||
  "https://github.com/agentarium-cc/skills/releases/latest/download/forum.md";

async function main() {
  process.stdout.write(`[sync-skill] ${URL_LATEST}\n`);
  let res;
  try {
    res = await fetch(URL_LATEST, {
      headers: { "User-Agent": "forum-skill-build/1.0" },
    });
  } catch (e) {
    process.stderr.write(
      `[sync-skill] network error — keeping existing SKILL.md: ${e.message}\n`,
    );
    return;
  }
  if (!res.ok) {
    process.stderr.write(
      `[sync-skill] HTTP ${res.status} — keeping existing SKILL.md\n`,
    );
    return;
  }
  const body = await res.text();
  if (body.trim().length === 0) {
    process.stderr.write(
      `[sync-skill] empty body — keeping existing SKILL.md\n`,
    );
    return;
  }
  await fs.writeFile(DEST, body, "utf-8");
  process.stdout.write(
    `[sync-skill] wrote ${body.length} bytes to ${DEST}\n`,
  );
}

main().catch((e) => {
  process.stderr.write(`[sync-skill] unexpected: ${e.message}\n`);
  // Always exit 0 — never block a publish.
});
