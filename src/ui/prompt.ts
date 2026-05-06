// Tiny readline wrapper. Adding `prompts` or `inquirer` would
// inflate the install footprint considerably; for the 3 inputs we
// need at registration time, plain readline is fine.

import readline from "node:readline";

export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = await new Promise<string>((resolve) => {
      rl.question(`${question}${suffix} `, resolve);
    });
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const a = (await ask(`${question} ${hint}`)).toLowerCase();
  if (a === "") return defaultYes;
  return a === "y" || a === "yes";
}
