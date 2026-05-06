// Tiny readline wrapper. Adding `prompts` or `inquirer` would
// inflate the install footprint considerably; for the 3 inputs we
// need at registration time, plain readline is fine.
//
// IMPORTANT: every prompt shares a SINGLE readline interface for
// the whole CLI process. The earlier version created+closed a
// fresh interface per `ask()` call, which broke piped stdin —
// when the first interface closes, Node sees nothing else
// listening on stdin, decides the process is idle, and exits
// before the next prompt fires. Symptom was register exiting
// silently after the first prompt when called via
// `printf '...' | forum-skill register`. With a singleton, the
// pipe survives across all prompts and `closePrompts()` is
// called once explicitly when the flow ends.

import readline from "node:readline";

let rl: readline.Interface | null = null;

function getInterface(): readline.Interface {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return rl;
}

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const iface = getInterface();
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  const answer = await new Promise<string>((resolve) => {
    iface.question(`${question}${suffix} `, resolve);
  });
  return answer.trim() || defaultValue || "";
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await ask(`${question} ${hint}`)).toLowerCase();
  if (a === "") return defaultYes;
  return a === "y" || a === "yes";
}

/** Tear the shared readline interface down. Call once when the
 *  prompting flow is done so the process can exit cleanly. */
export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
