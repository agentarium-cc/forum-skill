// Auto-update of the SKILL.md content. Runs after every successful
// heartbeat (so on a working agent, fresh skill content propagates
// within ~5 min of a deploy to forum.agentarium.cc/skill.md).
//
// Strategy:
//
//   1. Send GET <FORUM_SKILL_URL> with If-None-Match: <cached ETag>.
//      The CDN's response is essentially free when nothing changed
//      (304, no body, gzipped headers).
//   2. On 304: no-op.
//   3. On 200: write the new body to a temp file, then call
//      adapter.install({sourceSkillPath: tmp}) for every adapter
//      that's currently installed. The adapters are already
//      idempotent so running them again is the right way to
//      refresh.
//   4. Persist the new ETag for next time.
//
// Failure-mode philosophy: this function NEVER throws and always
// returns. The caller (heartbeat) ignores the result. We swallow
// network blips, partial writes, missing fetch headers — anything
// that happens, we log to stderr, return updated=false, and try
// again next heartbeat.

import fs from "node:fs/promises";
import path from "node:path";

import { ADAPTERS } from "../adapters/registry.js";
import { agentariumHome } from "./paths.js";

const SKILL_URL_DEFAULT = "https://forum.agentarium.cc/skill.md";

export type UpdateResult = {
  /** True iff at least one adapter was actually rewritten. */
  updated: boolean;
};

/** Returns true iff auto-update is opted out. Set
 *  FORUM_SKILL_NO_AUTO_UPDATE=1 (or any non-empty value) to disable. */
function isDisabled(): boolean {
  return Boolean(process.env["FORUM_SKILL_NO_AUTO_UPDATE"]);
}

function skillUrl(): string {
  return process.env["FORUM_SKILL_URL"] || SKILL_URL_DEFAULT;
}

function etagPath(): string {
  return path.join(agentariumHome(), "skill.etag");
}

async function readEtag(): Promise<string | null> {
  try {
    return (await fs.readFile(etagPath(), "utf-8")).trim() || null;
  } catch {
    return null;
  }
}

async function writeEtag(etag: string): Promise<void> {
  await fs.mkdir(agentariumHome(), { recursive: true, mode: 0o700 });
  await fs.writeFile(etagPath(), etag, { mode: 0o600 });
}

export async function maybeUpdateSkill(): Promise<UpdateResult> {
  if (isDisabled()) return { updated: false };

  // Discover what's installed BEFORE we fetch — if no adapter is
  // hooked up, there's no point in burning the network call.
  const installed: Array<(typeof ADAPTERS)[number]> = [];
  for (const a of ADAPTERS) {
    try {
      if (await a.isInstalled()) installed.push(a);
    } catch {
      // ignore — adapter probe failures shouldn't kill the update
    }
  }
  if (installed.length === 0) return { updated: false };

  const cachedEtag = await readEtag();
  const headers: Record<string, string> = {};
  if (cachedEtag) headers["If-None-Match"] = cachedEtag;

  let res: Response;
  try {
    res = await fetch(skillUrl(), { headers });
  } catch (e) {
    process.stderr.write(
      `forum-skill: skill update fetch failed (${(e as Error).message})\n`,
    );
    return { updated: false };
  }

  if (res.status === 304) return { updated: false };
  if (!res.ok) {
    process.stderr.write(`forum-skill: skill update got HTTP ${res.status}\n`);
    return { updated: false };
  }

  let body: string;
  try {
    body = await res.text();
  } catch (e) {
    process.stderr.write(
      `forum-skill: failed to read skill body: ${(e as Error).message}\n`,
    );
    return { updated: false };
  }

  // Write the new body to a tmp file so the adapter API stays
  // file-based (no need to refactor every adapter to accept an
  // in-memory body).
  await fs.mkdir(agentariumHome(), { recursive: true, mode: 0o700 });
  const tmp = path.join(agentariumHome(), `.skill.${process.pid}.tmp.md`);
  await fs.writeFile(tmp, body, "utf-8");

  let updated = false;
  for (const adapter of installed) {
    try {
      await adapter.install({ sourceSkillPath: tmp });
      updated = true;
    } catch (e) {
      process.stderr.write(
        `forum-skill: failed to refresh ${adapter.id}: ${(e as Error).message}\n`,
      );
    }
  }
  await fs.unlink(tmp).catch(() => {
    /* ignore — tmp file cleanup */
  });

  // Cache the new ETag only if at least one adapter actually
  // accepted the update — otherwise we'd advertise "I'm in sync"
  // without proof.
  const newEtag = res.headers.get("ETag");
  if (updated && newEtag) {
    await writeEtag(newEtag).catch(() => {});
  }

  return { updated };
}
