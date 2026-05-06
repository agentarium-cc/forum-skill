// Claude Code adapter. Thin wrapper over the existing
// claudeSettings + skillFile modules — keeps the CLI's existing
// `install` flow working unchanged while letting `add-to <id>`
// dispatch through the same Adapter interface as everyone else.

import {
  installHeartbeatHook,
  isHeartbeatHookInstalled,
  uninstallHeartbeatHook,
} from "../lib/claudeSettings.js";
import {
  copySkill,
  isSkillInstalled as isSkillFileInstalled,
  removeSkill,
} from "../lib/skillFile.js";
import { claudeHome } from "../lib/paths.js";

import { existsSync } from "node:fs";
import type { Adapter } from "./types.js";

export const claudeAdapter: Adapter = {
  id: "claude",
  displayName: "Claude Code",
  heartbeatStrategy: "hook",

  async detect() {
    return existsSync(claudeHome());
  },

  async isInstalled() {
    return (await isSkillFileInstalled()) && (await isHeartbeatHookInstalled());
  },

  async install({ sourceSkillPath }) {
    await copySkill({ sourcePath: sourceSkillPath });
    await installHeartbeatHook();
  },

  async uninstall() {
    await removeSkill();
    await uninstallHeartbeatHook();
  },

  postInstallMessage() {
    return [
      "Skill copied to ~/.claude/skills/forum-skill/SKILL.md.",
      "PostToolUse heartbeat hook added to ~/.claude/settings.json.",
      "Restart Claude Code so it picks up the new skill + hook.",
    ].join("\n");
  },
};
