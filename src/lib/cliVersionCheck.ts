// Once-a-day check against the npm registry for a newer version of
// forum-skill. We deliberately DO NOT auto-install — `update-
// notifier`-style: print a one-liner on the next interactive
// command so the user knows to run `npx forum-skill@latest install`.
//
// Triggered from interactive commands only (install, status,
// add-to, register). Never from `heartbeat --debounced` — the hook
// runs in agent tool output where extra lines would be noise.
//
// Hard-no-op cases:
//   - silent=true  (caller's choice; used when stdout is closed
//                   or the parent context can't display banners)
//   - FORUM_SKILL_NO_VERSION_CHECK=1
//   - cached check < 24h ago

import fs from "node:fs/promises";
import path from "node:path";

import { agentariumHome } from "./paths.js";

const REGISTRY_URL_DEFAULT = "https://registry.npmjs.org/forum-skill";
const CACHE_FILE = "cli-version-check.json";
const CACHE_TTL_MS = 24 * 60 * 60_000;

type CacheRecord = {
  latest: string;
  /** ISO timestamp of when we performed the check. */
  checkedAt: string;
};

export type CheckOptions = {
  currentVersion: string;
  /** If true, never fetch or write cache — return null. Used by
   *  callers that can't surface the banner. */
  silent?: boolean;
};

/** Returns the newer version string if one is available, else
 *  null. NEVER throws. */
export async function checkForUpdate(opts: CheckOptions): Promise<string | null> {
  if (opts.silent) return null;
  if (process.env["FORUM_SKILL_NO_VERSION_CHECK"]) return null;

  const cachePath = path.join(agentariumHome(), CACHE_FILE);

  // 1. Try the cache first.
  try {
    const stat = await fs.stat(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs < CACHE_TTL_MS) {
      const raw = await fs.readFile(cachePath, "utf-8");
      const cached = JSON.parse(raw) as CacheRecord;
      return compareVersions(opts.currentVersion, cached.latest);
    }
  } catch {
    // No cache, fall through to fetch.
  }

  // 2. Fetch.
  let latest: string;
  try {
    const res = await fetch(
      process.env["FORUM_SKILL_REGISTRY_URL"] || REGISTRY_URL_DEFAULT,
      {
        headers: {
          // npm registry's metadata-only response shape — saves
          // bandwidth vs the full package metadata.
          Accept: "application/vnd.npm.install-v1+json",
        },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { "dist-tags"?: { latest?: string } };
    latest = body["dist-tags"]?.latest ?? "";
  } catch {
    return null;
  }

  if (!latest) return null;

  // 3. Cache.
  try {
    await fs.mkdir(agentariumHome(), { recursive: true, mode: 0o700 });
    const record: CacheRecord = { latest, checkedAt: new Date().toISOString() };
    await fs.writeFile(cachePath, JSON.stringify(record), { mode: 0o600 });
  } catch {
    // ignore — non-fatal
  }

  return compareVersions(opts.currentVersion, latest);
}

/** Returns `latest` if it's strictly newer than `current` per
 *  semver, else null. We avoid pulling in `semver` for this — the
 *  comparison is small enough to inline, and adding a 200KB dep
 *  for one function is wasteful. */
function compareVersions(current: string, latest: string): string | null {
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return null;
  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (bv > av) return latest;
    if (bv < av) return null;
  }
  return null; // equal
}

function parseVersion(v: string): [number, number, number] | null {
  // Accept `1.2.3`, `1.2.3-rc.1`, `v1.2.3` — strip prefix & suffix.
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}
