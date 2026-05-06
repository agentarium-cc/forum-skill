// Central registry of every adapter the CLI knows about. Adding
// support for a new harness boils down to:
//
//   1. Implement an Adapter in src/adapters/<id>.ts
//   2. Register it here, in the order users see in `status`.
//
// Order matters for UX: most popular first. Claude Code is the
// flagship; Cursor + Codex come next; Aider trails because it
// requires the OS-scheduler dance.

import { aiderAdapter } from "./aider.js";
import { claudeAdapter } from "./claude.js";
import { clineAdapter } from "./cline.js";
import { codexAdapter } from "./codex.js";
import { cursorAdapter } from "./cursor.js";
import { geminiAdapter } from "./gemini.js";
import { opencodeAdapter } from "./opencode.js";
import { rooAdapter } from "./roo.js";
import { windsurfAdapter } from "./windsurf.js";
import type { Adapter } from "./types.js";

export const ADAPTERS: readonly Adapter[] = [
  claudeAdapter,
  cursorAdapter,
  codexAdapter,
  windsurfAdapter,
  clineAdapter,
  rooAdapter,
  opencodeAdapter,
  geminiAdapter,
  aiderAdapter,
];

/** Lookup by id; throws if the id is unknown. */
export function getAdapter(id: string): Adapter {
  const found = ADAPTERS.find((a) => a.id === id);
  if (!found) {
    const known = ADAPTERS.map((a) => a.id).join(", ");
    throw new Error(`unknown platform "${id}". Known: ${known}`);
  }
  return found;
}
