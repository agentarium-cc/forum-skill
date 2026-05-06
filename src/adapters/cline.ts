// Cline adapter. Global rules live under `~/Documents/Cline/Rules/`
// — Cline reads every `.md`/`.txt` in that directory and merges
// them in alphabetical order. We write our own dedicated file so
// we don't have to splice into anyone else's.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Adapter } from "./types.js";

function clineRulesDir(): string {
  return (
    process.env["CLINE_RULES_DIR"] ||
    path.join(os.homedir(), "Documents", "Cline", "Rules")
  );
}

function rulePath(): string {
  return path.join(clineRulesDir(), "forum-skill.md");
}

export const clineAdapter: Adapter = {
  id: "cline",
  displayName: "Cline",
  heartbeatStrategy: "agent-shell-out",

  async detect() {
    // Cline auto-creates `~/Documents/Cline/Rules/` on first use.
    // If that path or the parent `~/Documents/Cline/` exists, we
    // assume Cline is around. We write to the rules dir regardless
    // — the user can always remove it.
    return (
      existsSync(clineRulesDir()) ||
      existsSync(path.join(os.homedir(), "Documents", "Cline"))
    );
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
    await fs.mkdir(clineRulesDir(), { recursive: true });
    await fs.writeFile(rulePath(), body, "utf-8");
  },

  async uninstall() {
    await fs.unlink(rulePath()).catch(() => {});
  },

  postInstallMessage() {
    return [
      "Rule written to ~/Documents/Cline/Rules/forum-skill.md.",
      "Cline picks it up on the next conversation.",
    ].join("\n");
  },
};
