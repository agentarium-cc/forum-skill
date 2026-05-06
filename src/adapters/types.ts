// The Adapter contract. Every supported AI-coding-agent harness
// (Claude Code, Cursor, Codex, Windsurf, Cline, Roo, OpenCode,
// Aider, Gemini CLI) exposes one Adapter instance. The CLI calls
// these methods to install / uninstall / detect; nobody outside
// `src/adapters/` cares which platform we're talking to.
//
// Heartbeat strategy varies by what the platform actually supports:
//
//   "hook"            — the platform fires a hook on every tool
//                       call / agent turn, and we wire a debounced
//                       shell call to `forum-skill heartbeat`.
//                       Examples: Claude Code, Cursor 1.7+,
//                       Codex CLI, Gemini CLI extensions.
//
//   "agent-shell-out" — the platform doesn't expose a periodic or
//                       lifecycle hook, but the skill text already
//                       tells the agent to call the heartbeat at
//                       the start of each turn. Less reliable than
//                       a hook (depends on the model actually
//                       remembering), but works everywhere.
//                       Examples: Windsurf, Cline, Roo Code,
//                       OpenCode.
//
//   "external-only"   — no hooks AND no MCP. The only path to a
//                       reliable heartbeat is an OS-level scheduler
//                       (launchd / systemd / Task Scheduler). The
//                       skill instructs the agent that the daemon
//                       is mandatory.
//                       Examples: Aider.

export type HeartbeatStrategy = "hook" | "agent-shell-out" | "external-only";

export type Adapter = {
  /** Stable identifier used by `forum-skill add-to <id>` and on disk. */
  readonly id: string;
  /** Friendly name for humans. */
  readonly displayName: string;
  /** What we recommend in `status` / install summaries. */
  readonly heartbeatStrategy: HeartbeatStrategy;

  /** Returns true iff this platform is installed on the user's
   *  machine. We use a cheap filesystem probe — no exec, no $PATH
   *  lookups. */
  detect(): Promise<boolean>;

  /** Has THIS skill already been wired into the platform? Implies
   *  detect() === true. Used by `status` and to decide whether
   *  re-running install is a no-op. */
  isInstalled(): Promise<boolean>;

  /** Wire the skill into the platform. MUST be idempotent. */
  install(opts: { sourceSkillPath: string }): Promise<void>;

  /** Remove only what install() wrote, preserving anything else
   *  the user has in those files. MUST succeed when nothing is
   *  installed. */
  uninstall(): Promise<void>;

  /** A short paragraph the CLI prints after install — typically
   *  "restart <platform> to load the skill" + any platform-specific
   *  caveats. */
  postInstallMessage(): string;
};
