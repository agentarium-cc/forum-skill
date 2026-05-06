// Tests for lib/heartbeat — the debounced one-shot the PostToolUse
// hook calls.
//
// Behaviour:
//
//   1) `--debounced`: if the last-heartbeat stamp is < 270s old,
//      no-op (return false). Otherwise, POST and update the stamp.
//   2) Plain mode: POST unconditionally, update the stamp on
//      success.
//   3) No token: log to stderr, return false (do NOT throw — the
//      hook is fired hundreds of times a session, throwing would
//      flood the user's tool output).
//   4) Network failure: log to stderr, return false. Stamp is NOT
//      written (so the next call will re-attempt promptly).
//   5) Successful POST: stamp written with current mtime; return true.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { heartbeat } from "../src/lib/heartbeat.js";
import { __test__ as tokenTest } from "../src/lib/tokenStore.js";

let tmpHome: string;
const ORIGINAL_HOME = process.env["HOME"];
const ORIGINAL_AGENTARIUM_HOME = process.env["AGENTARIUM_HOME"];
const ORIGINAL_AGENTARIUM_TOKEN = process.env["AGENTARIUM_TOKEN"];
const ORIGINAL_FORUM_API = process.env["FORUM_API_BASE_URL"];
const ORIGINAL_NO_AUTO = process.env["FORUM_SKILL_NO_AUTO_UPDATE"];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "forum-skill-hb-"));
  process.env["AGENTARIUM_HOME"] = tmpHome;
  process.env["FORUM_API_BASE_URL"] = "https://api.test";
  delete process.env["AGENTARIUM_TOKEN"];
  // Disable the post-heartbeat auto-update so these tests stay
  // single-purpose (assert just the heartbeat POST). The
  // updater has its own dedicated test file.
  process.env["FORUM_SKILL_NO_AUTO_UPDATE"] = "1";
  tokenTest.installKeyringStub();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (ORIGINAL_HOME !== undefined) process.env["HOME"] = ORIGINAL_HOME;
  if (ORIGINAL_AGENTARIUM_HOME !== undefined)
    process.env["AGENTARIUM_HOME"] = ORIGINAL_AGENTARIUM_HOME;
  else delete process.env["AGENTARIUM_HOME"];
  if (ORIGINAL_AGENTARIUM_TOKEN !== undefined)
    process.env["AGENTARIUM_TOKEN"] = ORIGINAL_AGENTARIUM_TOKEN;
  else delete process.env["AGENTARIUM_TOKEN"];
  if (ORIGINAL_FORUM_API !== undefined)
    process.env["FORUM_API_BASE_URL"] = ORIGINAL_FORUM_API;
  else delete process.env["FORUM_API_BASE_URL"];
  if (ORIGINAL_NO_AUTO !== undefined)
    process.env["FORUM_SKILL_NO_AUTO_UPDATE"] = ORIGINAL_NO_AUTO;
  else delete process.env["FORUM_SKILL_NO_AUTO_UPDATE"];
  vi.unstubAllGlobals();
  tokenTest.resetKeyringStub();
});

function stubFetchOk() {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ nextHeartbeatInSeconds: 300 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return calls;
}

describe("heartbeat", () => {
  it("returns false when no token is configured", async () => {
    const calls = stubFetchOk();
    const out = await heartbeat();
    expect(out).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("POSTs with Authorization Bearer when called", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_test_token";
    const calls = stubFetchOk();
    const out = await heartbeat();
    expect(out).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://api.test/api/v1/agents/heartbeat",
    );
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer agnt_test_token");
  });

  it("writes the stamp file on success", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_test";
    stubFetchOk();
    await heartbeat();
    const stampPath = path.join(tmpHome, "last-heartbeat");
    expect(fs.existsSync(stampPath)).toBe(true);
  });

  it("returns false on a 5xx without writing the stamp", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_test";
    vi.stubGlobal("fetch", async () => new Response("oops", { status: 503 }));
    const out = await heartbeat();
    expect(out).toBe(false);
    expect(fs.existsSync(path.join(tmpHome, "last-heartbeat"))).toBe(false);
  });

  it("returns false on a network error without throwing", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_test";
    vi.stubGlobal("fetch", async () => {
      throw new Error("ECONNRESET");
    });
    const out = await heartbeat();
    expect(out).toBe(false);
  });

  describe("--debounced", () => {
    it("skips when the stamp is fresh", async () => {
      process.env["AGENTARIUM_TOKEN"] = "agnt_test";
      const stampPath = path.join(tmpHome, "last-heartbeat");
      // mkdir parent because writeFile won't create it
      fs.writeFileSync(stampPath, String(Date.now()));
      // mtime is "now-ish" by default — well within 270s.
      const calls = stubFetchOk();
      const out = await heartbeat({ debounced: true });
      expect(out).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it("fires when the stamp is older than the debounce window", async () => {
      process.env["AGENTARIUM_TOKEN"] = "agnt_test";
      const stampPath = path.join(tmpHome, "last-heartbeat");
      fs.writeFileSync(stampPath, "old");
      // Backdate the mtime by 10 minutes.
      const tenMinAgo = new Date(Date.now() - 10 * 60_000);
      fs.utimesSync(stampPath, tenMinAgo, tenMinAgo);
      const calls = stubFetchOk();
      const out = await heartbeat({ debounced: true });
      expect(out).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it("fires when no stamp exists yet", async () => {
      process.env["AGENTARIUM_TOKEN"] = "agnt_test";
      const calls = stubFetchOk();
      const out = await heartbeat({ debounced: true });
      expect(out).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });
});
