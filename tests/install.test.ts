// End-to-end test for the `install` command. Drives the orchestrator
// against a tmp HOME + a stubbed device flow + a stubbed skill source.
//
// We're testing the orchestration: do we copy the skill, do we add
// the hook, do we kick off registration when there's no token, and
// is everything idempotent.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runInstall } from "../src/commands/install.js";
import { __test__ as tokenTest, loadToken, saveToken } from "../src/lib/tokenStore.js";

let tmpHome: string;
let tmpPkg: string;
const ORIG_CLAUDE = process.env["CLAUDE_CONFIG_DIR"];
const ORIG_AGENT = process.env["AGENTARIUM_HOME"];
const ORIG_TOKEN = process.env["AGENTARIUM_TOKEN"];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "fs-install-claude-"));
  tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), "fs-install-pkg-"));
  fs.writeFileSync(path.join(tmpPkg, "SKILL.md"), "# canonical\n");
  process.env["CLAUDE_CONFIG_DIR"] = tmpHome;
  process.env["AGENTARIUM_HOME"] = path.join(tmpHome, "agnt");
  delete process.env["AGENTARIUM_TOKEN"];
  tokenTest.installKeyringStub();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpPkg, { recursive: true, force: true });
  if (ORIG_CLAUDE !== undefined) process.env["CLAUDE_CONFIG_DIR"] = ORIG_CLAUDE;
  else delete process.env["CLAUDE_CONFIG_DIR"];
  if (ORIG_AGENT !== undefined) process.env["AGENTARIUM_HOME"] = ORIG_AGENT;
  else delete process.env["AGENTARIUM_HOME"];
  if (ORIG_TOKEN !== undefined) process.env["AGENTARIUM_TOKEN"] = ORIG_TOKEN;
  else delete process.env["AGENTARIUM_TOKEN"];
  vi.unstubAllGlobals();
  tokenTest.resetKeyringStub();
});

describe("install", () => {
  it("copies SKILL.md, adds the hook, and reports skipped registration when a token already exists", async () => {
    await saveToken("agnt_already_here");

    const out = await runInstall({
      sourceSkillPath: path.join(tmpPkg, "SKILL.md"),
      // Pass a registration callback that should never be called when
      // a token is already configured.
      register: async () => {
        throw new Error("should not register when token exists");
      },
    });

    expect(out.skillCopied).toBe(true);
    expect(out.hookInstalled).toBe(true);
    expect(out.registered).toBe(false);
    // Skill copied to the right place.
    expect(
      fs.readFileSync(
        path.join(tmpHome, "skills", "forum-skill", "SKILL.md"),
        "utf-8",
      ),
    ).toBe("# canonical\n");
    // Hook landed in settings.json.
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, "settings.json"), "utf-8"),
    );
    expect(settings.hooks.PostToolUse).toEqual([
      expect.objectContaining({ id: "forum-skill:heartbeat" }),
    ]);
  });

  it("triggers registration when no token is found and stores the result", async () => {
    let registerCalled = false;
    const out = await runInstall({
      sourceSkillPath: path.join(tmpPkg, "SKILL.md"),
      register: async () => {
        registerCalled = true;
        return { token: "agnt_new", handle: "next-medic" };
      },
    });
    expect(registerCalled).toBe(true);
    expect(out.registered).toBe(true);
    expect(await loadToken()).toBe("agnt_new");
  });

  it("is idempotent — running twice produces the same end state", async () => {
    await saveToken("agnt_x");
    await runInstall({ sourceSkillPath: path.join(tmpPkg, "SKILL.md"), register: async () => ({ token: "x", handle: "h" }) });
    await runInstall({ sourceSkillPath: path.join(tmpPkg, "SKILL.md"), register: async () => ({ token: "x", handle: "h" }) });
    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpHome, "settings.json"), "utf-8"),
    );
    expect(settings.hooks.PostToolUse).toHaveLength(1);
  });

  it("does not store a token when registration is skipped via skipRegister", async () => {
    const out = await runInstall({
      sourceSkillPath: path.join(tmpPkg, "SKILL.md"),
      skipRegister: true,
      register: async () => {
        throw new Error("should not be called");
      },
    });
    expect(out.registered).toBe(false);
    expect(await loadToken()).toBeNull();
  });
});
