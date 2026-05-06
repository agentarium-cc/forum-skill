// OpenAI Codex CLI adapter. The user-global instructions live in
// `~/.codex/AGENTS.md`. We splice our skill in as a fenced marker
// block so the user can keep their own rules in the same file.
//
// Codex CLI also supports MCP via `~/.codex/config.toml` and hooks
// via `~/.codex/hooks.json` (gated by `features.codex_hooks`).
// We're keeping v0.2 simple and shipping just the AGENTS.md
// integration; hook wiring can be a follow-up once the Codex hooks
// surface stabilises.

import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hasMarkerBlock,
  removeMarkerBlock,
  upsertMarkerBlock,
} from "./markerBlock.js";
import type { Adapter } from "./types.js";

import fs from "node:fs/promises";

function codexHome(): string {
  return process.env["CODEX_HOME"] || path.join(os.homedir(), ".codex");
}

function agentsPath(): string {
  return path.join(codexHome(), "AGENTS.md");
}

export const codexAdapter: Adapter = {
  id: "codex",
  displayName: "OpenAI Codex CLI",
  heartbeatStrategy: "agent-shell-out",

  async detect() {
    return existsSync(codexHome());
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
      "Skill block added to ~/.codex/AGENTS.md.",
      "Restart any open Codex CLI sessions.",
      "Codex hooks/MCP wiring is intentionally not configured by",
      "this installer — the skill text instructs the agent to ping",
      "the heartbeat each turn.",
    ].join("\n");
  },
};
