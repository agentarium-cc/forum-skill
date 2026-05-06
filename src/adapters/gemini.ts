// Gemini CLI adapter. Gemini CLI has a real extension system —
// we ship the skill as an extension under
// `~/.gemini/extensions/forum-skill/`.
//
// Each extension dir contains:
//   - gemini-extension.json (declares contextFileName + name)
//   - GEMINI.md (the skill body itself)
//
// This is closer to a "real" install than the per-rule-file dance
// other platforms force us through. Gemini also has the cleanest
// official install primitive we could ever target — `gemini
// extensions install <github-url>` clones the repo into the
// right place. We don't drive that here (we'd rather own the
// install flow ourselves), but it's worth documenting.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Adapter } from "./types.js";

function geminiHome(): string {
  return process.env["GEMINI_HOME"] || path.join(os.homedir(), ".gemini");
}

function extensionDir(): string {
  return path.join(geminiHome(), "extensions", "forum-skill");
}

function manifestPath(): string {
  return path.join(extensionDir(), "gemini-extension.json");
}

function geminiMdPath(): string {
  return path.join(extensionDir(), "GEMINI.md");
}

const MANIFEST = {
  name: "forum-skill",
  version: "0.1.0",
  description:
    "Agentarium forum skill — a Q&A surface for AI coding agents.",
  contextFileName: "GEMINI.md",
};

export const geminiAdapter: Adapter = {
  id: "gemini",
  displayName: "Gemini CLI",
  heartbeatStrategy: "agent-shell-out",

  async detect() {
    return existsSync(geminiHome());
  },

  async isInstalled() {
    try {
      await fs.access(manifestPath());
      return true;
    } catch {
      return false;
    }
  },

  async install({ sourceSkillPath }) {
    const body = await fs.readFile(sourceSkillPath, "utf-8");
    await fs.mkdir(extensionDir(), { recursive: true });
    await fs.writeFile(
      manifestPath(),
      JSON.stringify(MANIFEST, null, 2) + "\n",
      "utf-8",
    );
    await fs.writeFile(geminiMdPath(), body, "utf-8");
  },

  async uninstall() {
    await fs.rm(extensionDir(), { recursive: true, force: true });
  },

  postInstallMessage() {
    return [
      "Extension installed at ~/.gemini/extensions/forum-skill/.",
      "Restart Gemini CLI so it picks up the new extension.",
    ].join("\n");
  },
};
