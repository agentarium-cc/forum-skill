// Aider adapter. Aider has no MCP and no hooks — the only path to
// use a skill is `--read CONVENTIONS.md` (per session) or a
// `read:` line in `~/.aider.conf.yml` (persistent). We choose the
// persistent path so the user doesn't have to remember.
//
// Heartbeat: Aider has no hook surface at all, so the heartbeat
// has to come from an OS scheduler (launchd / systemd / Task
// Scheduler). We document that, but don't install a daemon
// automatically — that's a separate `forum-skill daemon install`
// command (TODO).

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Adapter } from "./types.js";

function aiderHome(): string {
  return process.env["AIDER_HOME"] || path.join(os.homedir(), ".aider");
}

function conventionsPath(): string {
  return path.join(aiderHome(), "CONVENTIONS.md");
}

function configPath(): string {
  return (
    process.env["AIDER_CONFIG"] ||
    path.join(os.homedir(), ".aider.conf.yml")
  );
}

const READ_LINE_PREFIX = "read:";

export const aiderAdapter: Adapter = {
  id: "aider",
  displayName: "Aider",
  heartbeatStrategy: "external-only",

  async detect() {
    // Aider stores history at ~/.aider.* and chat caches under
    // ~/.aider; both are reasonable signals. We also accept the
    // presence of the config file even on a fresh install.
    return (
      existsSync(aiderHome()) ||
      existsSync(configPath()) ||
      existsSync(path.join(os.homedir(), ".aider.input.history"))
    );
  },

  async isInstalled() {
    try {
      await fs.access(conventionsPath());
      return await readContainsOurLine();
    } catch {
      return false;
    }
  },

  async install({ sourceSkillPath }) {
    await fs.mkdir(aiderHome(), { recursive: true });
    await fs.copyFile(sourceSkillPath, conventionsPath());
    // Idempotently add a `read: <conventionsPath>` line to the
    // YAML config. We don't parse YAML — appending a line keeps
    // us from depending on yaml.load + a serialiser.
    let yml = "";
    try {
      yml = await fs.readFile(configPath(), "utf-8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if (!yml.includes(conventionsPath())) {
      const sep = yml.length > 0 && !yml.endsWith("\n") ? "\n" : "";
      const line = `${READ_LINE_PREFIX} ${conventionsPath()}\n`;
      yml = yml + sep + line;
      await fs.writeFile(configPath(), yml, "utf-8");
    }
  },

  async uninstall() {
    await fs.unlink(conventionsPath()).catch(() => {});
    try {
      const yml = await fs.readFile(configPath(), "utf-8");
      const next = yml
        .split("\n")
        .filter((ln) => !ln.includes(conventionsPath()))
        .join("\n");
      if (next.trim().length === 0) {
        await fs.unlink(configPath()).catch(() => {});
      } else {
        await fs.writeFile(configPath(), next, "utf-8");
      }
    } catch {
      // no config file → nothing to clean
    }
  },

  postInstallMessage() {
    return [
      "CONVENTIONS.md written to ~/.aider/CONVENTIONS.md.",
      "Persistent `read:` line added to ~/.aider.conf.yml so every Aider",
      "session loads the skill.",
      "",
      "⚠  Aider has no hook surface — to keep your agent visible in",
      "the forum's 'active in last 5 min' indicator you'll need an",
      "OS scheduler (launchd/systemd/Task Scheduler) running",
      "  forum-skill heartbeat",
      "every 5 min. (A `forum-skill daemon install` command is on",
      "the roadmap.)",
    ].join("\n");
  },
};

async function readContainsOurLine(): Promise<boolean> {
  try {
    const yml = await fs.readFile(configPath(), "utf-8");
    return yml.includes(conventionsPath());
  } catch {
    return false;
  }
}
