// Tests for lib/paths — the single source for every filesystem
// path the CLI touches (Claude home, agentarium home, settings file,
// the skill destination, the heartbeat-debounce stamp file).
//
// We honour HOME and CLAUDE_CONFIG_DIR env overrides so the test
// suite can point at a tmp directory without monkey-patching `os`.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";

import {
  agentariumHome,
  claudeHome,
  claudeSettingsPath,
  heartbeatStampPath,
  skillDestPath,
  tokenFilePath,
} from "../src/lib/paths.js";

const ORIGINAL_HOME = process.env["HOME"];
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env["CLAUDE_CONFIG_DIR"];
const ORIGINAL_AGENTARIUM_HOME = process.env["AGENTARIUM_HOME"];

describe("paths", () => {
  beforeEach(() => {
    delete process.env["CLAUDE_CONFIG_DIR"];
    delete process.env["AGENTARIUM_HOME"];
  });

  afterEach(() => {
    if (ORIGINAL_HOME !== undefined) process.env["HOME"] = ORIGINAL_HOME;
    if (ORIGINAL_CLAUDE_CONFIG_DIR !== undefined)
      process.env["CLAUDE_CONFIG_DIR"] = ORIGINAL_CLAUDE_CONFIG_DIR;
    else delete process.env["CLAUDE_CONFIG_DIR"];
    if (ORIGINAL_AGENTARIUM_HOME !== undefined)
      process.env["AGENTARIUM_HOME"] = ORIGINAL_AGENTARIUM_HOME;
    else delete process.env["AGENTARIUM_HOME"];
  });

  it("claudeHome defaults to $HOME/.claude", () => {
    expect(claudeHome()).toBe(path.join(os.homedir(), ".claude"));
  });

  it("claudeHome honours CLAUDE_CONFIG_DIR", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "/tmp/fake-claude";
    expect(claudeHome()).toBe("/tmp/fake-claude");
  });

  it("claudeSettingsPath is settings.json under claudeHome", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "/tmp/fake-claude";
    expect(claudeSettingsPath()).toBe("/tmp/fake-claude/settings.json");
  });

  it("skillDestPath nests under claudeHome/skills/forum-skill", () => {
    process.env["CLAUDE_CONFIG_DIR"] = "/tmp/fake-claude";
    expect(skillDestPath()).toBe(
      "/tmp/fake-claude/skills/forum-skill/SKILL.md",
    );
  });

  it("agentariumHome defaults to $HOME/.agentarium", () => {
    expect(agentariumHome()).toBe(path.join(os.homedir(), ".agentarium"));
  });

  it("agentariumHome honours AGENTARIUM_HOME", () => {
    process.env["AGENTARIUM_HOME"] = "/tmp/agnt";
    expect(agentariumHome()).toBe("/tmp/agnt");
  });

  it("tokenFilePath sits under agentariumHome", () => {
    process.env["AGENTARIUM_HOME"] = "/tmp/agnt";
    expect(tokenFilePath()).toBe("/tmp/agnt/token");
  });

  it("heartbeatStampPath sits under agentariumHome", () => {
    process.env["AGENTARIUM_HOME"] = "/tmp/agnt";
    expect(heartbeatStampPath()).toBe("/tmp/agnt/last-heartbeat");
  });
});
