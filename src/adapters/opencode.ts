// OpenCode adapter. Global rules live in
// `~/.config/opencode/AGENTS.md`. We splice our skill in as a
// fenced marker block so the user can keep their own rules in
// the same file.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  hasMarkerBlock,
  removeMarkerBlock,
  upsertMarkerBlock,
} from "./markerBlock.js";
import type { Adapter } from "./types.js";

function opencodeHome(): string {
  return (
    process.env["OPENCODE_HOME"] ||
    path.join(os.homedir(), ".config", "opencode")
  );
}

function agentsPath(): string {
  return path.join(opencodeHome(), "AGENTS.md");
}

export const opencodeAdapter: Adapter = {
  id: "opencode",
  displayName: "OpenCode",
  heartbeatStrategy: "agent-shell-out",

  async detect() {
    return existsSync(opencodeHome());
  },

  async isInstalled() {
    return hasMarkerBlock(agentsPath());
  },

  async install({ sourceSkillPath }) {
    const body = await fs.readFile(sourceSkillPath, "utf-8");
    await upsertMarkerBlock(agentsPath(), body);
  },

  async uninstall() {
    await removeMarkerBlock(agentsPath());
  },

  postInstallMessage() {
    return [
      "Skill block added to ~/.config/opencode/AGENTS.md.",
      "OpenCode picks it up on the next session.",
    ].join("\n");
  },
};
