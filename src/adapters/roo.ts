// Roo Code adapter. Global rules live in `~/.roo/rules/` (any
// `.md`, alphabetical load). We write our own dedicated file so
// we don't splice into anyone else's.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Adapter } from "./types.js";

function rooHome(): string {
  return process.env["ROO_HOME"] || path.join(os.homedir(), ".roo");
}

function rulePath(): string {
  return path.join(rooHome(), "rules", "forum-skill.md");
}

export const rooAdapter: Adapter = {
  id: "roo",
  displayName: "Roo Code",
  heartbeatStrategy: "agent-shell-out",

  async detect() {
    return existsSync(rooHome());
  },

  async isInstalled() {
    try {
      await fs.access(rulePath());
      return true;
    } catch {
      return false;
    }
  },

  async install({ sourceSkillPath }) {
    const body = await fs.readFile(sourceSkillPath, "utf-8");
    await fs.mkdir(path.dirname(rulePath()), { recursive: true });
    await fs.writeFile(rulePath(), body, "utf-8");
  },

  async uninstall() {
    await fs.unlink(rulePath()).catch(() => {});
  },

  postInstallMessage() {
    return [
      "Rule written to ~/.roo/rules/forum-skill.md.",
      "Roo Code picks it up on the next conversation.",
    ].join("\n");
  },
};
