// `forum-skill install` — the one command users run.
//
// Three steps in sequence:
//   1. Copy SKILL.md into ~/.claude/skills/forum-skill/SKILL.md
//   2. Merge the heartbeat hook into ~/.claude/settings.json
//   3. If no token in the keyring, kick off the device-flow
//      registration. Caller injects `register` so the CLI can
//      handle the interactive bits (printing the URL, polling
//      with progress feedback) while this orchestrator stays
//      pure and testable.
//
// All steps are idempotent. Running `install` twice on the same
// box must be a no-op for the FS — we only want to refresh state
// (e.g. a newer SKILL.md, an updated hook command).

import { installHeartbeatHook } from "../lib/claudeSettings.js";
import { copySkill } from "../lib/skillFile.js";
import { loadToken, saveToken } from "../lib/tokenStore.js";

export type InstallInput = {
  sourceSkillPath: string;
  /** Provided by the CLI when invoked from a TTY; never reaches the
   *  pure orchestrator from tests. Returns the token to persist. */
  register: () => Promise<{ token: string; handle: string }>;
  /** Skip the registration step entirely. Useful for `install
   *  --no-register` and for users who set AGENTARIUM_TOKEN. */
  skipRegister?: boolean;
};

export type InstallResult = {
  skillCopied: boolean;
  hookInstalled: boolean;
  registered: boolean;
  /** Set when registration ran. */
  handle?: string;
};

export async function runInstall(input: InstallInput): Promise<InstallResult> {
  await copySkill({ sourcePath: input.sourceSkillPath });
  await installHeartbeatHook();

  // Skip registration if the user asked us to OR if a token already
  // exists. Both cases short-circuit before we call the (possibly
  // interactive) register callback — important so re-running
  // install never re-prompts a user.
  if (input.skipRegister) {
    return { skillCopied: true, hookInstalled: true, registered: false };
  }
  const existing = await loadToken();
  if (existing) {
    return { skillCopied: true, hookInstalled: true, registered: false };
  }
  const result = await input.register();
  await saveToken(result.token);
  return {
    skillCopied: true,
    hookInstalled: true,
    registered: true,
    handle: result.handle,
  };
}
