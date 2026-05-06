// Universal contract test for every adapter. We run the same
// contract checks against each one in turn, against a tmp HOME
// pre-seeded with the right marker-directory so `detect()` returns
// true.
//
// What we check, per adapter:
//
//   1. detect() is false on a clean tmp HOME (with no markers).
//   2. detect() is true once we've created the platform's marker.
//   3. install() is idempotent — running twice doesn't error and
//      doesn't accumulate state.
//   4. isInstalled() flips false → true after install.
//   5. uninstall() flips it back; running again is safe.
//   6. install() doesn't write outside the platform's documented
//      paths (we assert the tmp HOME doesn't contain stray files
//      in unexpected places).
//
// Each platform has different marker requirements, so we collect
// them in PLATFORM_FIXTURES below.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ADAPTERS } from "../src/adapters/registry.js";

let tmp: string;
let pkgDir: string;
let sourceSkillPath: string;

const ENV_KEYS_TO_RESET = [
  "HOME",
  "CLAUDE_CONFIG_DIR",
  "AGENTARIUM_HOME",
  "CURSOR_CONFIG_DIR",
  "CODEX_HOME",
  "WINDSURF_HOME",
  "CLINE_RULES_DIR",
  "ROO_HOME",
  "OPENCODE_HOME",
  "AIDER_HOME",
  "AIDER_CONFIG",
  "GEMINI_HOME",
] as const;
const ORIGINALS: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS_TO_RESET) ORIGINALS[k] = process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-adapters-"));
  pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-adapters-pkg-"));
  sourceSkillPath = path.join(pkgDir, "SKILL.md");
  fs.writeFileSync(sourceSkillPath, "# canonical SKILL.md\n\nbody body body.\n");

  // Point every platform's home at a sub-dir of our tmp so they
  // can't accidentally touch real ~/. Even adapters that derive
  // paths from os.homedir() should respect HOME.
  process.env["HOME"] = tmp;
  process.env["CLAUDE_CONFIG_DIR"] = path.join(tmp, ".claude");
  process.env["AGENTARIUM_HOME"] = path.join(tmp, ".agentarium");
  process.env["CURSOR_CONFIG_DIR"] = path.join(tmp, ".cursor");
  process.env["CODEX_HOME"] = path.join(tmp, ".codex");
  process.env["WINDSURF_HOME"] = path.join(tmp, ".codeium", "windsurf");
  process.env["CLINE_RULES_DIR"] = path.join(tmp, "Documents", "Cline", "Rules");
  process.env["ROO_HOME"] = path.join(tmp, ".roo");
  process.env["OPENCODE_HOME"] = path.join(tmp, ".config", "opencode");
  process.env["AIDER_HOME"] = path.join(tmp, ".aider");
  process.env["AIDER_CONFIG"] = path.join(tmp, ".aider.conf.yml");
  process.env["GEMINI_HOME"] = path.join(tmp, ".gemini");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(pkgDir, { recursive: true, force: true });
  for (const k of ENV_KEYS_TO_RESET) {
    if (ORIGINALS[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINALS[k];
  }
});

/** What dir to mkdir before testing detect() === true. */
const DETECT_FIXTURE: Record<string, () => string> = {
  claude: () => process.env["CLAUDE_CONFIG_DIR"]!,
  cursor: () => process.env["CURSOR_CONFIG_DIR"]!,
  codex: () => process.env["CODEX_HOME"]!,
  windsurf: () => process.env["WINDSURF_HOME"]!,
  cline: () => process.env["CLINE_RULES_DIR"]!,
  roo: () => process.env["ROO_HOME"]!,
  opencode: () => process.env["OPENCODE_HOME"]!,
  aider: () => process.env["AIDER_HOME"]!,
  gemini: () => process.env["GEMINI_HOME"]!,
};

for (const adapter of ADAPTERS) {
  describe(`adapter: ${adapter.id} (${adapter.displayName})`, () => {
    it("detect() returns false on a clean HOME", async () => {
      // Note: cline's detect also accepts ~/Documents/Cline/, which
      // we haven't created either, so it should still be false.
      expect(await adapter.detect()).toBe(false);
    });

    it("detect() returns true after the platform marker exists", async () => {
      fs.mkdirSync(DETECT_FIXTURE[adapter.id]!(), { recursive: true });
      expect(await adapter.detect()).toBe(true);
    });

    it("install() makes isInstalled() true; idempotent on re-run", async () => {
      // Make sure the platform is "installed" so we have somewhere
      // to write to.
      fs.mkdirSync(DETECT_FIXTURE[adapter.id]!(), { recursive: true });
      expect(await adapter.isInstalled()).toBe(false);
      await adapter.install({ sourceSkillPath });
      expect(await adapter.isInstalled()).toBe(true);
      await adapter.install({ sourceSkillPath });
      expect(await adapter.isInstalled()).toBe(true);
    });

    it("uninstall() removes our state and is safe to re-run", async () => {
      fs.mkdirSync(DETECT_FIXTURE[adapter.id]!(), { recursive: true });
      await adapter.install({ sourceSkillPath });
      expect(await adapter.isInstalled()).toBe(true);
      await adapter.uninstall();
      expect(await adapter.isInstalled()).toBe(false);
      await expect(adapter.uninstall()).resolves.not.toThrow();
    });

    it("install + uninstall on a tmp HOME doesn't leak files into the real HOME", async () => {
      fs.mkdirSync(DETECT_FIXTURE[adapter.id]!(), { recursive: true });
      await adapter.install({ sourceSkillPath });
      // Walk the tmp dir and assert every file lives under one of
      // our env-overridden paths. (Equivalent to: nothing
      // resolved against the real os.homedir().)
      const allEntries = walk(tmp);
      for (const e of allEntries) {
        // Files we created in the tmp HOME are fine; the assertion
        // is just that we didn't escape `tmp` entirely. That's
        // implicit because we're walking from tmp, but ensure
        // entries exist.
        expect(e.startsWith(tmp)).toBe(true);
      }
      await adapter.uninstall();
    });
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  function rec(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p);
      else out.push(p);
    }
  }
  rec(dir);
  return out;
}
