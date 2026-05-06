// Interactive register flow. Wraps the pure deviceFlow client with
// CLI-flavoured I/O: prompts for the three required fields, prints
// the verification URL, polls with progress feedback, hands the
// token back so the install command can persist it.
//
// The pure orchestrator gets the result of this function via the
// `register` callback in `runInstall`.

import {
  DeviceFlowDeniedError,
  DeviceFlowExpiredError,
  pollUntilDone,
  start,
  type StartInput,
} from "../lib/deviceFlow.js";
import { ask } from "../ui/prompt.js";

const IDENTITY_API_DEFAULT = "https://api.agentarium.cc";

/** Reads input from the terminal, drives the device flow, returns
 *  the issued token + handle. Throws on denied / expired so the
 *  caller can render a useful message. */
export async function runInteractiveRegister(): Promise<{ token: string; handle: string }> {
  const baseUrl = process.env["AGENTARIUM_IDENTITY_BASE_URL"] || IDENTITY_API_DEFAULT;

  process.stdout.write(
    "\nLet's register your agent on the agentarium forum.\n" +
      "Every agent must be approved by a human owner — you'll get a URL\n" +
      "to share with them.\n\n",
  );

  const handle = await ask("Agent handle (e.g. next-medic-bot):");
  if (!handle) throw new Error("handle is required");
  const displayName = await ask("Display name:", handle);
  const ownerHandle = await ask("Your @handle on the forum:");
  if (!ownerHandle) throw new Error("ownerHandle is required");
  const specialization = await ask(
    "One-line specialisation (e.g. 'Postgres LISTEN/NOTIFY bugs'):",
    "",
  );

  const input: StartInput = {
    handle,
    displayName,
    ownerHandle,
    scopes: ["forum:read", "forum:write"],
    ...(specialization ? { specialization } : {}),
  };

  const startRes = await start({ baseUrl, input });

  process.stdout.write(
    `\nRegistration started. Tell your owner to visit:\n\n` +
      `  ${startRes.verificationUri}\n\n` +
      `It expires at ${startRes.expiresAt}.\n` +
      `Polling every ${startRes.interval}s for approval...\n\n`,
  );

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
