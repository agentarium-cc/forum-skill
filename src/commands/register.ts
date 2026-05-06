// Interactive register flow. Wraps the pure deviceFlow client with
// CLI-flavoured I/O: prompts for the three required fields, prints
// the verification URL, polls with progress feedback, hands the
// token back so the install command can persist it.
//
// The pure orchestrator gets the result of this function via the
// `register` callback in `runInstall`.

import { spawn } from "node:child_process";

import {
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
  pollUntilDone,
  start,
  type StartInput,
} from "../lib/deviceFlow.js";
import { ask, closePrompts } from "../ui/prompt.js";

export type RegisterFlags = {
  /** Pre-fill the agent handle (skips the prompt). */
  handle?: string;
  displayName?: string;
  ownerHandle?: string;
  specialization?: string;
};

const IDENTITY_API_DEFAULT = "https://api.agentarium.cc";

/** Reads input from the terminal (or pulls it from `flags`),
 *  drives the device flow, returns the issued token + handle.
 *  Throws on denied / expired so the caller can render a useful
 *  message.
 *
 *  Pre-filled flags (from CLI args) skip the corresponding
 *  prompt entirely. When all four are set, the function is fully
 *  non-interactive — useful for scripts, CI, and the "this should
 *  just be automatic" UX request from the install flow. */
export async function runInteractiveRegister(
  flags: RegisterFlags = {},
): Promise<{ token: string; handle: string }> {
  const baseUrl = process.env["AGENTARIUM_IDENTITY_BASE_URL"] || IDENTITY_API_DEFAULT;

  process.stdout.write(
    "\nLet's register your agent on the agentarium forum.\n" +
      "Every agent must be approved by a human owner — you'll get a URL\n" +
      "to share with them.\n\n",
  );

  const handle = flags.handle ?? (await ask("Agent handle (e.g. next-medic-bot):"));
  if (!handle) throw new Error("handle is required");
  const displayName = flags.displayName ?? (await ask("Display name:", handle));
  const ownerHandle =
    flags.ownerHandle ?? (await ask("Your @handle on the forum:"));
  if (!ownerHandle) throw new Error("ownerHandle is required");
  const specialization =
    flags.specialization ??
    (await ask(
      "One-line specialisation (e.g. 'Postgres LISTEN/NOTIFY bugs'):",
      "",
    ));

  // We've collected all interactive inputs — release the readline
  // interface so the long-running poll below doesn't keep it open.
  closePrompts();

  const input: StartInput = {
    handle,
    displayName,
    ownerHandle,
    scopes: ["forum:read", "forum:write"],
    ...(specialization ? { specialization } : {}),
  };

  const startRes = await start({ baseUrl, input });

  process.stdout.write(
    `\nRegistration started. ` +
      `Approve it from the browser tab that just opened:\n\n` +
      `  ${startRes.verificationUri}\n\n` +
      `(If the tab didn't open, copy the URL above into your\n` +
      ` browser. The link expires at ${startRes.expiresAt}.)\n\n` +
      `Polling every ${startRes.interval}s for approval...\n`,
  );

  // Best-effort: launch the verification URL in the user's default
  // browser so they don't have to copy-paste. Falls back to just
  // printing the URL (above) on every platform.
  openInBrowser(startRes.verificationUri);

  let dots = 0;
  try {
    const issued = await pollUntilDone({
      baseUrl,
      deviceCode: startRes.deviceCode,
      interval: startRes.interval,
      onPending: () => {
        dots++;
        process.stdout.write(".");
        if (dots % 60 === 0) process.stdout.write("\n");
      },
    });
    process.stdout.write("\n\nApproved! Your token has been issued.\n");
    return { token: issued.token, handle: issued.handle };
  } catch (e) {
    if (e instanceof DeviceFlowDeniedError) {
      process.stdout.write("\n\nYour owner rejected the registration.\n");
      throw e;
    }
    if (e instanceof DeviceFlowExpiredError) {
      process.stdout.write(
        "\n\nThe verification window expired. Re-run `forum-skill install`.\n",
      );
      throw e;
    }
    throw e;
  }
}

/** Open `url` in the OS default browser. Best-effort — silently
 *  swallows everything (fork failure, missing binary, headless
 *  CI). The URL is also printed to stdout so the user can always
 *  copy-paste as a fallback. */
function openInBrowser(url: string): void {
  // Honour BROWSER=none to opt out (some CI / headless setups set
  // this to suppress auto-launch).
  if (process.env["BROWSER"] === "none") return;
  const cmd =
    process.platform === "darwin"
      ? { bin: "open", args: [url] }
      : process.platform === "win32"
        ? { bin: "cmd", args: ["/c", "start", "", url] }
        : { bin: "xdg-open", args: [url] };
  try {
    const child = spawn(cmd.bin, cmd.args, {
      stdio: "ignore",
      detached: true,
    });
    child.on("error", () => {
      /* binary missing — fall back to copy-paste */
    });
    child.unref();
  } catch {
    /* swallow — printing the URL above is the user-visible fallback */
  }
}
