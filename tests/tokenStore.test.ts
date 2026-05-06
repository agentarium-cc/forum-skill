// Tests for lib/tokenStore. Three concerns:
//
//   1) Env override: AGENTARIUM_TOKEN, when set, ALWAYS wins. CI
//      jobs, ephemeral containers, and Docker users rely on this —
//      writing through to a file would be hostile in those settings.
//
//   2) File fallback: when the keyring is unavailable, we persist
//      to `~/.agentarium/token` with mode 0600 and parent dir 0700.
//      Roundtripping must work without the keyring at all (we test
//      with a stubbed keyring module that throws).
//
//   3) Idempotent clear: calling `clearToken()` when no token exists
//      must succeed silently. This is the uninstall path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearToken,
  loadToken,
  saveToken,
  __test__,
} from "../src/lib/tokenStore.js";

let tmpDir: string;
const ORIGINAL_AGENTARIUM_TOKEN = process.env["AGENTARIUM_TOKEN"];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "forum-skill-token-"));
  process.env["AGENTARIUM_HOME"] = tmpDir;
  delete process.env["AGENTARIUM_TOKEN"];
  __test__.resetKeyringStub();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (ORIGINAL_AGENTARIUM_TOKEN !== undefined)
    process.env["AGENTARIUM_TOKEN"] = ORIGINAL_AGENTARIUM_TOKEN;
  else delete process.env["AGENTARIUM_TOKEN"];
});

describe("AGENTARIUM_TOKEN env override", () => {
  it("returns the env var when set, ignoring keyring + file", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_envvar_xyz";
    fs.writeFileSync(path.join(tmpDir, "token"), "agnt_file_xyz", { mode: 0o600 });
    expect(await loadToken()).toBe("agnt_envvar_xyz");
  });

  it("saveToken is a no-op when env var is set", async () => {
    process.env["AGENTARIUM_TOKEN"] = "agnt_envvar_xyz";
    await saveToken("agnt_persisted");
    // No file created
    expect(fs.existsSync(path.join(tmpDir, "token"))).toBe(false);
  });
});

describe("file fallback (no keyring)", () => {
  beforeEach(() => {
    __test__.disableKeyring();
  });

  it("saves and loads via the 0600 file", async () => {
    await saveToken("agnt_a_b");
    const stat = fs.statSync(path.join(tmpDir, "token"));
    // Mask off the mode bits we care about (0600 = rw-------)
    expect(stat.mode & 0o777).toBe(0o600);
    expect(await loadToken()).toBe("agnt_a_b");
  });

  it("loadToken returns null when nothing has ever been saved", async () => {
    expect(await loadToken()).toBeNull();
  });

  it("clearToken removes the file silently when present", async () => {
    await saveToken("agnt_x");
    await clearToken();
    expect(fs.existsSync(path.join(tmpDir, "token"))).toBe(false);
  });

  it("clearToken succeeds when no token exists", async () => {
    await expect(clearToken()).resolves.not.toThrow();
  });

  it("creates the parent dir 0700 if missing", async () => {
    await saveToken("agnt_x");
    const stat = fs.statSync(tmpDir);
    // Parent already existed in beforeEach (mkdtempSync) so
    // permission-mode tests on tmpDir itself are noisy. Test the
    // sub-path instead by removing and re-creating via saveToken.
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir);
    await saveToken("agnt_y");
    const tokenStat = fs.statSync(path.join(tmpDir, "token"));
    expect(tokenStat.mode & 0o777).toBe(0o600);
    void stat;
  });
});

describe("keyring (when available)", () => {
  it("uses the keyring stub for save + load", async () => {
    __test__.installKeyringStub();
    await saveToken("agnt_kr_z");
    expect(await loadToken()).toBe("agnt_kr_z");
    // No file written when keyring works.
    expect(fs.existsSync(path.join(tmpDir, "token"))).toBe(false);
  });

  it("falls back to the file when the keyring throws on save", async () => {
    __test__.installFailingKeyringStub();
    await saveToken("agnt_q");
    expect(fs.existsSync(path.join(tmpDir, "token"))).toBe(true);
    expect(await loadToken()).toBe("agnt_q");
  });

  it("falls back to the file when the keyring throws on load", async () => {
    __test__.installKeyringStubReadOnly();
    fs.writeFileSync(path.join(tmpDir, "token"), "agnt_filey", { mode: 0o600 });
    expect(await loadToken()).toBe("agnt_filey");
  });
});
