// Tests for lib/cliVersionCheck. Behaviour:
//
//   1. First run: fetches `https://registry.npmjs.org/forum-skill`,
//      compares `dist-tags.latest` with the current version, caches
//      the result for 24h, returns the latest version if newer or
//      null if not.
//   2. Within 24h of last check: reads the cache, no fetch.
//   3. After 24h: re-fetches, refreshes cache.
//   4. Network errors: return null (never throw, never crash the
//      caller).
//   5. Disabled by env var FORUM_SKILL_NO_VERSION_CHECK=1.
//   6. Disabled when running as the heartbeat hook (we never want
//      the hook to print update notices into the user's tool
//      output) — the public API exposes a `silent` mode.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkForUpdate } from "../src/lib/cliVersionCheck.js";

let tmp: string;
const ORIG_HOME = process.env["AGENTARIUM_HOME"];
const ORIG_DISABLED = process.env["FORUM_SKILL_NO_VERSION_CHECK"];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-cli-ver-"));
  process.env["AGENTARIUM_HOME"] = tmp;
  delete process.env["FORUM_SKILL_NO_VERSION_CHECK"];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  if (ORIG_HOME !== undefined) process.env["AGENTARIUM_HOME"] = ORIG_HOME;
  else delete process.env["AGENTARIUM_HOME"];
  if (ORIG_DISABLED !== undefined)
    process.env["FORUM_SKILL_NO_VERSION_CHECK"] = ORIG_DISABLED;
  else delete process.env["FORUM_SKILL_NO_VERSION_CHECK"];
  vi.unstubAllGlobals();
});

function stubRegistry(latest: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({ "dist-tags": { latest } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}

describe("checkForUpdate", () => {
  it("returns the new version when registry's latest is newer", async () => {
    stubRegistry("0.5.0");
    const r = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r).toBe("0.5.0");
  });

  it("returns null when current === latest", async () => {
    stubRegistry("0.1.0");
    const r = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r).toBeNull();
  });

  it("returns null when current > latest (locally-built or dev tag)", async () => {
    stubRegistry("0.0.5");
    const r = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r).toBeNull();
  });

  it("caches the result; second call within 24h does not refetch", async () => {
    stubRegistry("0.5.0");
    await checkForUpdate({ currentVersion: "0.1.0" });
    const callsAfterFirst = vi.mocked(globalThis.fetch).mock.calls.length;
    await checkForUpdate({ currentVersion: "0.1.0" });
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsAfterFirst);
  });

  it("re-fetches when the cache is stale (> 24h)", async () => {
    stubRegistry("0.5.0");
    await checkForUpdate({ currentVersion: "0.1.0" });
    // Backdate the cache file by 25h.
    const cachePath = path.join(tmp, "cli-version-check.json");
    const oldStamp = new Date(Date.now() - 25 * 60 * 60_000);
    fs.utimesSync(cachePath, oldStamp, oldStamp);

    // Switch the registry to a newer version + verify second call
    // refetches.
    stubRegistry("0.7.0");
    const r2 = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r2).toBe("0.7.0");
  });

  it("network error: returns null, no cache poisoning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const r = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r).toBeNull();
    // No cache file written on failure.
    expect(fs.existsSync(path.join(tmp, "cli-version-check.json"))).toBe(false);
  });

  it("disabled by FORUM_SKILL_NO_VERSION_CHECK=1", async () => {
    process.env["FORUM_SKILL_NO_VERSION_CHECK"] = "1";
    let fetched = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetched = true;
        return new Response("");
      }),
    );
    const r = await checkForUpdate({ currentVersion: "0.1.0" });
    expect(r).toBeNull();
    expect(fetched).toBe(false);
  });

  it("silent mode skips both fetch and cache write", async () => {
    let fetched = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetched = true;
        return new Response(JSON.stringify({ "dist-tags": { latest: "9.9.9" } }));
      }),
    );
    const r = await checkForUpdate({ currentVersion: "0.1.0", silent: true });
    expect(r).toBeNull();
    expect(fetched).toBe(false);
  });
});
