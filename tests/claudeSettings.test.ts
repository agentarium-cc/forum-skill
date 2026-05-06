// Tests for lib/claudeSettings — the idempotent merger that adds
// our PostToolUse heartbeat hook to ~/.claude/settings.json without
// trampling whatever else the user already has there.
//
// What we MUST NOT do:
//   - Replace the whole file
//   - Drop the user's other hooks
//   - Add a duplicate entry on re-install
//   - Re-format / re-key the user's JSON in surprising ways
//
// What we MUST do:
//   - Create the file from scratch when it doesn't exist
//   - Preserve unrelated top-level keys (mcpServers, permissions, …)
//   - Preserve other PostToolUse hook entries
//   - Match our own entry by `id` so the re-install path can update
//     its `command` if we ever need to

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  HEARTBEAT_HOOK_ID,
  installHeartbeatHook,
  isHeartbeatHookInstalled,
  uninstallHeartbeatHook,
} from "../src/lib/claudeSettings.js";

let tmpHome: string;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env["CLAUDE_CONFIG_DIR"];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "forum-skill-claude-"));
  process.env["CLAUDE_CONFIG_DIR"] = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  if (ORIGINAL_CLAUDE_CONFIG_DIR !== undefined)
    process.env["CLAUDE_CONFIG_DIR"] = ORIGINAL_CLAUDE_CONFIG_DIR;
  else delete process.env["CLAUDE_CONFIG_DIR"];
});

function readSettings(): any {
  return JSON.parse(fs.readFileSync(path.join(tmpHome, "settings.json"), "utf-8"));
}

describe("installHeartbeatHook", () => {
  it("creates settings.json with the hook when nothing exists", async () => {
    await installHeartbeatHook();
    const s = readSettings();
    expect(s.hooks?.PostToolUse).toEqual([
      expect.objectContaining({
        id: HEARTBEAT_HOOK_ID,
        command: expect.stringContaining("forum-skill heartbeat"),
      }),
    ]);
  });

  it("preserves unrelated top-level keys", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "settings.json"),
      JSON.stringify({
        mcpServers: { foo: { command: "node", args: ["foo.js"] } },
        permissions: { allow: ["Bash(ls)"] },
      }),
    );
    await installHeartbeatHook();
    const s = readSettings();
    expect(s.mcpServers).toEqual({ foo: { command: "node", args: ["foo.js"] } });
    expect(s.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(s.hooks.PostToolUse).toBeDefined();
  });

  it("preserves the user's existing PostToolUse hooks", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ id: "user-existing", command: "echo done" }],
          PreToolUse: [{ id: "user-pre", command: "echo pre" }],
        },
      }),
    );
    await installHeartbeatHook();
    const s = readSettings();
    expect(s.hooks.PreToolUse).toEqual([{ id: "user-pre", command: "echo pre" }]);
    const ids = s.hooks.PostToolUse.map((h: any) => h.id);
    expect(ids).toContain("user-existing");
    expect(ids).toContain(HEARTBEAT_HOOK_ID);
  });

  it("is idempotent — second install does not add a duplicate", async () => {
    await installHeartbeatHook();
    await installHeartbeatHook();
    const s = readSettings();
    const heartbeatEntries = s.hooks.PostToolUse.filter(
      (h: any) => h.id === HEARTBEAT_HOOK_ID,
    );
    expect(heartbeatEntries).toHaveLength(1);
  });

  it("updates the existing entry in place if our command string changes", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [
            { id: HEARTBEAT_HOOK_ID, command: "old-stale-command" },
          ],
        },
      }),
    );
    await installHeartbeatHook();
    const s = readSettings();
    const ours = s.hooks.PostToolUse.find(
      (h: any) => h.id === HEARTBEAT_HOOK_ID,
    );
    expect(ours.command).toContain("forum-skill heartbeat");
  });
});

describe("isHeartbeatHookInstalled", () => {
  it("returns false on a fresh box", async () => {
    expect(await isHeartbeatHookInstalled()).toBe(false);
  });

  it("returns true after install", async () => {
    await installHeartbeatHook();
    expect(await isHeartbeatHookInstalled()).toBe(true);
  });
});

describe("uninstallHeartbeatHook", () => {
  it("removes only our entry, leaving others intact", async () => {
    fs.writeFileSync(
      path.join(tmpHome, "settings.json"),
      JSON.stringify({
        hooks: {
          PostToolUse: [{ id: "user-existing", command: "echo done" }],
        },
      }),
    );
    await installHeartbeatHook();
    await uninstallHeartbeatHook();
    const s = readSettings();
    expect(s.hooks.PostToolUse).toEqual([
      { id: "user-existing", command: "echo done" },
    ]);
  });

  it("succeeds when nothing is installed", async () => {
    await expect(uninstallHeartbeatHook()).resolves.not.toThrow();
  });

  it("removes empty PostToolUse array after our entry is gone", async () => {
    await installHeartbeatHook();
    await uninstallHeartbeatHook();
    const s = readSettings();
    // Either PostToolUse is deleted entirely or it's an empty array;
    // both are acceptable. We assert "no remnants".
    if (s.hooks?.PostToolUse) {
      expect(s.hooks.PostToolUse).toEqual([]);
    }
  });
});
