// Shared helper for adapters that need to APPEND our skill into a
// shared file (AGENTS.md, global_rules.md, etc.) rather than write
// our own dedicated file. Marker comments fence our block so we can
// idempotently update or remove it without trampling the user's
// surrounding content.
//
// The markers are HTML-style (`<!-- ... -->`) because every platform
// that uses this pattern reads markdown — markdown renderers ignore
// HTML comments, so the markers are invisible to the reader and the
// model parses past them naturally.

import fs from "node:fs/promises";
import path from "node:path";

const BEGIN = "<!-- FORUM-SKILL BEGIN — managed by forum-skill; do not edit by hand -->";
const END = "<!-- FORUM-SKILL END -->";

/** Insert or replace our block in `filePath`. Creates the file +
 *  parent dir if missing. Trailing newline is normalised. */
export async function upsertMarkerBlock(
  filePath: string,
  body: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }

  const block = `${BEGIN}\n${body.trimEnd()}\n${END}\n`;
  // Match an entire fenced block including the leading newline so
  // re-running install doesn't accumulate blank lines around it.
  const re = new RegExp(
    `\\n*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`,
    "m",
  );
  let next: string;
  if (re.test(existing)) {
    next = existing.replace(re, `\n\n${block}`);
  } else if (existing.trim().length === 0) {
    next = block;
  } else {
    next = `${existing.trimEnd()}\n\n${block}`;
  }
  await fs.writeFile(filePath, next, "utf-8");
}

/** Remove our block from `filePath`. If the file ends up empty,
 *  delete it. */
export async function removeMarkerBlock(filePath: string): Promise<void> {
  let existing: string;
  try {
    existing = await fs.readFile(filePath, "utf-8");
  } catch {
    return; // already clean
  }
  const re = new RegExp(
    `\\n*${escapeRegExp(BEGIN)}[\\s\\S]*?${escapeRegExp(END)}\\n?`,
    "m",
  );
  if (!re.test(existing)) return;
  const next = existing.replace(re, "").replace(/\n{3,}$/m, "\n").trimEnd();
  if (next.trim().length === 0) {
    await fs.unlink(filePath).catch(() => {});
  } else {
    await fs.writeFile(filePath, next + "\n", "utf-8");
  }
}

/** Returns true iff our block is currently present in `filePath`. */
export async function hasMarkerBlock(filePath: string): Promise<boolean> {
  try {
    const existing = await fs.readFile(filePath, "utf-8");
    return existing.includes(BEGIN);
  } catch {
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const __test__ = { BEGIN, END };
