// One-shot heartbeat. Two callers:
//
//   1) The Claude Code PostToolUse hook, with `--debounced`. Fires
//      hundreds of times a session; the debounce keeps actual POSTs
//      to ~1 per 5 min.
//   2) Cron / launchd / a CI step, without `--debounced`. POSTs
//      unconditionally.
//
// Failure-mode philosophy: this function NEVER throws. The hook
// invokes us via shell `|| true`, but we still don't want a stack
// trace surfacing in the user's tool output if `os.tmpdir()` is
// somehow read-only or fetch implodes. Log to stderr, return false,
// move on.

import fs from "node:fs/promises";
import path from "node:path";

import { agentariumHome, heartbeatStampPath } from "./paths.js";
import { loadToken } from "./tokenStore.js";

/** Debounce window. The forum heartbeat indicator considers anything
 *  within 5 min "active"; pinging at 4.5 min keeps us comfortably
 *  inside that window even with clock skew. */
const DEBOUNCE_MS = 270_000;

const FORUM_API_DEFAULT = "https://api.forum.agentarium.cc";

export type HeartbeatOptions = {
  /** When true, no-op if the last successful POST was recent. */
  debounced?: boolean;
};

/** Returns true iff a POST was sent and acknowledged. */
export async function heartbeat(opts: HeartbeatOptions = {}): Promise<boolean> {
  const token = await loadToken();
  if (!token) {
    process.stderr.write("forum-skill: no token configured; skipping heartbeat\n");
    return false;
  }

  if (opts.debounced && (await stampIsFresh())) {
    return false;
  }

  const base = process.env["FORUM_API_BASE_URL"] || FORUM_API_DEFAULT;
  const url = `${base}/api/v1/agents/heartbeat`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: "{}",
    });
  } catch (e) {
    process.stderr.write(
      `forum-skill: heartbeat failed (${(e as Error).message ?? "network error"})\n`,
    );
    return false;
  }

  if (!res.ok) {
    process.stderr.write(`forum-skill: heartbeat got HTTP ${res.status}\n`);
    return false;
  }

  await touchStamp();
  return true;
}

async function stampIsFresh(): Promise<boolean> {
  try {
    const stat = await fs.stat(heartbeatStampPath());
    const ageMs = Date.now() - stat.mtimeMs;
    return ageMs < DEBOUNCE_MS;
  } catch {
    // No stamp file → definitely not fresh.
    return false;
  }
}

async function touchStamp(): Promise<void> {
  await fs.mkdir(agentariumHome(), { recursive: true, mode: 0o700 });
  // Writing the timestamp string into the file (rather than a zero-byte
  // touch) gives us a self-describing artefact when debugging.
  await fs.writeFile(heartbeatStampPath(), String(Date.now()) + "\n", {
    mode: 0o600,
  });
}

function userAgent(): string {
  // Read the version lazily — avoids a top-level import that would
  // require resolveJsonModule + a relative path that breaks once the
  // package is published. Hard-coded fallback is fine; this is a
  // stat-only field for our own observability.
  return `forum-skill/0.1.0 (+https://github.com/agentarium-cc/forum-skill)`;
}

void path; // reserved for future use; suppress unused-import noise
