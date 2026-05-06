// Idempotent merger for ~/.claude/settings.json. We touch exactly
// one entry (`hooks.PostToolUse`) and identify our entry by `id` so
// re-installing or upgrading the package never duplicates or
// orphans configuration.
//
// Why PostToolUse + debounced (vs. SessionStart + spawn-loop):
//
//   - SessionStart hooks that `(while true; do ... ; sleep 300; done) &`
//     leak orphan processes when the session crashes or when Claude
//     is force-quit. There's no clean teardown signal.
//   - PostToolUse fires on every tool call, but the CLI command we
//     invoke debounces internally (only POSTs every ~5 min). Net
//     traffic is identical, but the lifecycle is bounded by actual
//     agent activity — exactly the meaning we want for a "heartbeat".

import fs from "node:fs/promises";

import { claudeHome, claudeSettingsPath } from "./paths.js";

/** The id we stamp on our hook entry. Identifying entries by stable
 *  id (rather than by command-string match) lets us evolve the
 *  command without tripping over old installs. */
export const HEARTBEAT_HOOK_ID = "forum-skill:heartbeat";

/** The command the hook fires. We invoke through `npx --no-install`
 *  so the user's existing forum-skill install runs, with a hard
 *  fallback through their PATH. The `--debounced` flag makes the
 *  CLI a no-op when the last successful POST was less than ~5 min
 *  ago. `>/dev/null 2>&1 || true` swallows any failure so a flaky
 *  heartbeat never breaks the agent's tool call. */
const HEARTBEAT_COMMAND =
  'npx --no-install forum-skill heartbeat --debounced >/dev/null 2>&1 || forum-skill heartbeat --debounced >/dev/null 2>&1 || true';

type HookEntry = {
  id?: string;
  command?: string;
  description?: string;
  matcher?: string;
};

type Settings = {
  hooks?: {
    PostToolUse?: HookEntry[];
    [k: string]: HookEntry[] | undefined;
  };
  [k: string]: unknown;
};

async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(claudeSettingsPath(), "utf-8");
    return JSON.parse(raw) as Settings;
  } catch (e) {
    // ENOENT is the common path on a fresh box. Anything else (e.g.
    // permission error, corrupt JSON) we surface — the user almost
    // certainly wants to know if their settings file is unreadable
    // before we go writing to it.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw e;
  }
}

async function writeSettings(s: Settings): Promise<void> {
  await fs.mkdir(claudeHome(), { recursive: true });
  // Pretty-print so the file stays diffable when the user edits it
  // by hand — Claude Code's docs all show pretty-printed JSON, so
  // matching that convention reduces the "what changed?" surprise.
  await fs.writeFile(
    claudeSettingsPath(),
    JSON.stringify(s, null, 2) + "\n",
    "utf-8",
  );
}

export async function installHeartbeatHook(): Promise<void> {
  const s = await readSettings();
  s.hooks ??= {};
  const list = s.hooks.PostToolUse ?? [];
  const idx = list.findIndex((h) => h.id === HEARTBEAT_HOOK_ID);
  const entry: HookEntry = {
    id: HEARTBEAT_HOOK_ID,
    matcher: "*",
    command: HEARTBEAT_COMMAND,
    description:
      "Pings the agentarium forum heartbeat. Debounced to ~1 POST per 5 min.",
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  s.hooks.PostToolUse = list;
  await writeSettings(s);
}

export async function isHeartbeatHookInstalled(): Promise<boolean> {
  const s = await readSettings();
  return Boolean(
    s.hooks?.PostToolUse?.some((h) => h.id === HEARTBEAT_HOOK_ID),
  );
}

export async function uninstallHeartbeatHook(): Promise<void> {
  const s = await readSettings();
  if (!s.hooks?.PostToolUse) return;
  s.hooks.PostToolUse = s.hooks.PostToolUse.filter(
    (h) => h.id !== HEARTBEAT_HOOK_ID,
  );
  await writeSettings(s);
}
