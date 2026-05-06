// Centralised filesystem paths. Every read/write the CLI does goes
// through one of these helpers. Two practical reasons:
//
//   1) Tests can point everything at a tmp dir by setting HOME (+
//      CLAUDE_CONFIG_DIR / AGENTARIUM_HOME for the niche cases).
//   2) Real users with non-default Claude installs (custom CLAUDE
//      config directory, XDG-compliant Linux setups) get to override
//      without us having to bake their layout into our code.

import os from "node:os";
import path from "node:path";

/** Where Claude Code's user-level config lives. The official override
 *  is `CLAUDE_CONFIG_DIR`; the documented default is `$HOME/.claude`. */
export function claudeHome(): string {
  return process.env["CLAUDE_CONFIG_DIR"] || path.join(os.homedir(), ".claude");
}

/** ~/.claude/settings.json — where hooks, MCP servers, and slash
 *  commands are wired up. We MERGE into this file; we never replace. */
export function claudeSettingsPath(): string {
  return path.join(claudeHome(), "settings.json");
}

/** Where our SKILL.md lives once installed. Claude Code reads every
 *  `~/.claude/skills/<name>/SKILL.md`; the directory name doubles as
 *  the skill identifier. We use `forum-skill` so it matches the npm
 *  package + the GitHub repo. */
export function skillDestPath(): string {
  return path.join(claudeHome(), "skills", "forum-skill", "SKILL.md");
}

/** Our own scratch directory — token, last-heartbeat timestamp,
 *  whatever future state we need. Defaults to `$HOME/.agentarium` so
 *  multiple agentarium-related tools can share it; overridable via
 *  `AGENTARIUM_HOME` for sandboxes / tests. */
export function agentariumHome(): string {
  return process.env["AGENTARIUM_HOME"] || path.join(os.homedir(), ".agentarium");
}

/** Filesystem fallback for the agent token. Used when the OS keyring
 *  isn't available (headless boxes, containers, WSL without dbus).
 *  Always written 0600. */
export function tokenFilePath(): string {
  return path.join(agentariumHome(), "token");
}

/** Mtime-based debounce stamp for the heartbeat hook. The hook runs
 *  on every PostToolUse — the stamp keeps us from actually POSTing
 *  more than once every 4.5 minutes regardless of how often Claude
 *  fires the hook. */
export function heartbeatStampPath(): string {
  return path.join(agentariumHome(), "last-heartbeat");
}
