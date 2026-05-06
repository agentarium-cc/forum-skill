// Tests for lib/skillFile — copies the package's SKILL.md into
// ~/.claude/skills/forum-skill/SKILL.md.
//
// The interesting case is "where does the source SKILL.md live?".
// At runtime (post-install), it's `<package-root>/SKILL.md`. In
// tests we inject the source path directly so we don't have to
// fight with `import.meta.url` resolution.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { copySkill, isSkillInstalled, removeSkill } from "../src/lib/skillFile.js";

let tmpHome: string;
let tmpPkg: string;
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env["CLAUDE_CONFIG_DIR"];

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "forum-skill-skill-"));
  tmpPkg = fs.mkdtempSync(path.join(os.tmpdir(), "forum-skill-pkg-"));
  fs.writeFileSync(
    path.join(tmpPkg, "SKILL.md"),
    "# Forum skill\n\nHello.\n",
  );
  process.env["CLAUDE_CONFIG_DIR"] = tmpHome;
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpPkg, { recursive: true, force: true });
  if (ORIGINAL_CLAUDE_CONFIG_DIR !== undefined)
    process.env["CLAUDE_CONFIG_DIR"] = ORIGINAL_CLAUDE_CONFIG_DIR;
  else delete process.env["CLAUDE_CONFIG_DIR"];
});

describe("copySkill", () => {
  it("creates the directory tree and copies the source", async () => {
    await copySkill({ sourcePath: path.join(tmpPkg, "SKILL.md") });
    const dest = path.join(tmpHome, "skills", "forum-skill", "SKILL.md");
    expect(fs.readFileSync(dest, "utf-8")).toBe("# Forum skill\n\nHello.\n");
  });

  it("overwrites an existing copy on re-install (idempotent)", async () => {
    const dest = path.join(tmpHome, "skills", "forum-skill", "SKILL.md");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "stale content");
    await copySkill({ sourcePath: path.join(tmpPkg, "SKILL.md") });
    expect(fs.readFileSync(dest, "utf-8")).toBe("# Forum skill\n\nHello.\n");
  });

  it("throws a clear error when the source SKILL.md is missing", async () => {
    await expect(
      copySkill({ sourcePath: path.join(tmpPkg, "ghost.md") }),
    ).rejects.toThrow(/SKILL\.md/);
  });
});

describe("isSkillInstalled", () => {
  it("returns false on a fresh box", async () => {
    expect(await isSkillInstalled()).toBe(false);
  });
  it("returns true after copy", async () => {
    await copySkill({ sourcePath: path.join(tmpPkg, "SKILL.md") });
    expect(await isSkillInstalled()).toBe(true);
  });
});

describe("removeSkill", () => {
  it("removes the file + the dedicated dir", async () => {
    await copySkill({ sourcePath: path.join(tmpPkg, "SKILL.md") });
    await removeSkill();
    expect(fs.existsSync(path.join(tmpHome, "skills", "forum-skill"))).toBe(false);
  });
  it("succeeds when nothing is installed", async () => {
    await expect(removeSkill()).resolves.not.toThrow();
  });
});
