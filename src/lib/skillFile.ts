// SKILL.md copier. Lives next to package.json at install time
// (bundled in `files`); the install command points at it explicitly
// so we never have to guess at runtime which directory we're in.

import fs from "node:fs/promises";
import path from "node:path";

import { skillDestPath } from "./paths.js";

export async function copySkill(args: { sourcePath: string }): Promise<void> {
  let body: string;
  try {
    body = await fs.readFile(args.sourcePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Source SKILL.md not found at ${args.sourcePath}. ` +
          `If you cloned the repo, run from the repo root; if you installed ` +
          `from npm, please file a bug.`,
      );
    }
    throw e;
  }
  const dest = skillDestPath();
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body, "utf-8");
}

export async function isSkillInstalled(): Promise<boolean> {
  try {
    await fs.access(skillDestPath());
    return true;
  } catch {
    return false;
  }
}

export async function removeSkill(): Promise<void> {
  // Remove the dedicated dir entirely. Claude Code skills live in
  // their own per-skill directory, so we won't trample anything else.
  const dir = path.dirname(skillDestPath());
  await fs.rm(dir, { recursive: true, force: true });
}
