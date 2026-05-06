// Tests for lib/skillUpdater. Behaviour we're locking down:
//
//   1. First run (no cached ETag): GET fires, body is written to
//      every installed adapter, ETag is cached.
//   2. Subsequent run with matching ETag: server replies 304, no
//      adapter is rewritten.
//   3. Subsequent run with stale ETag: server replies 200 with new
//      ETag + new body; every installed adapter is refreshed; new
//      ETag is cached.
//   4. Network error → returns false, doesn't throw, doesn't cache
//      a bogus ETag.
//   5. Refresh ONLY hits adapters that are currently installed —
//      never picks up "detected but not installed".
//   6. Disabled by env var FORUM_SKILL_NO_AUTO_UPDATE=1.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ADAPTERS } from "../src/adapters/registry.js";
import { maybeUpdateSkill } from "../src/lib/skillUpdater.js";

let tmp: string;
const ENV_KEYS = [
  "HOME",
  "AGENTARIUM_HOME",
  "CLAUDE_CONFIG_DIR",
  "CURSOR_CONFIG_DIR",
  "CODEX_HOME",
  "WINDSURF_HOME",
  "CLINE_RULES_DIR",
  "ROO_HOME",
  "OPENCODE_HOME",
  "AIDER_HOME",
  "AIDER_CONFIG",
  "GEMINI_HOME",
  "FORUM_SKILL_URL",
  "FORUM_SKILL_NO_AUTO_UPDATE",
] as const;
const ORIGINALS: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) ORIGINALS[k] = process.env[k];
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-skill-update-"));
  process.env["HOME"] = tmp;
  process.env["AGENTARIUM_HOME"] = path.join(tmp, ".agentarium");
  process.env["CLAUDE_CONFIG_DIR"] = path.join(tmp, ".claude");
  process.env["CURSOR_CONFIG_DIR"] = path.join(tmp, ".cursor");
  process.env["CODEX_HOME"] = path.join(tmp, ".codex");
  process.env["WINDSURF_HOME"] = path.join(tmp, ".codeium", "windsurf");
  process.env["CLINE_RULES_DIR"] = path.join(tmp, "Documents", "Cline", "Rules");
  process.env["ROO_HOME"] = path.join(tmp, ".roo");
  process.env["OPENCODE_HOME"] = path.join(tmp, ".config", "opencode");
  process.env["AIDER_HOME"] = path.join(tmp, ".aider");
  process.env["AIDER_CONFIG"] = path.join(tmp, ".aider.conf.yml");
  process.env["GEMINI_HOME"] = path.join(tmp, ".gemini");
  process.env["FORUM_SKILL_URL"] = "https://forum.test/skill.md";
  delete process.env["FORUM_SKILL_NO_AUTO_UPDATE"];
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const k of ENV_KEYS) {
    if (ORIGINALS[k] === undefined) delete process.env[k];
    else process.env[k] = ORIGINALS[k];
  }
  vi.unstubAllGlobals();
});

function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}

async function installClaudeAndCursor(initialBody = "# v1\n") {
  const sourceTmp = path.join(tmp, "src-skill.md");
  fs.writeFileSync(sourceTmp, initialBody);
  fs.mkdirSync(process.env["CLAUDE_CONFIG_DIR"]!, { recursive: true });
  fs.mkdirSync(process.env["CURSOR_CONFIG_DIR"]!, { recursive: true });
  const claude = ADAPTERS.find((a) => a.id === "claude")!;
  const cursor = ADAPTERS.find((a) => a.id === "cursor")!;
  await claude.install({ sourceSkillPath: sourceTmp });
  await cursor.install({ sourceSkillPath: sourceTmp });
}

function readClaudeBody() {
  return fs.readFileSync(
    path.join(process.env["CLAUDE_CONFIG_DIR"]!, "skills", "forum-skill", "SKILL.md"),
    "utf-8",
  );
}

function readCursorBody() {
  return fs.readFileSync(
    path.join(process.env["CURSOR_CONFIG_DIR"]!, "rules", "forum-skill.mdc"),
    "utf-8",
  );
}

describe("maybeUpdateSkill", () => {
  it("returns {updated:false} when no adapters are installed (nothing to update)", async () => {
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return new Response("", { status: 200 });
    });
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(false);
    expect(fetched).toBe(false);
  });

  it("first run: fetches body, writes to all installed adapters, caches ETag", async () => {
    await installClaudeAndCursor("# old\n");
    stubFetch((url, init) => {
      expect(url).toBe("https://forum.test/skill.md");
      // No If-None-Match on first run.
      expect(new Headers(init?.headers).get("If-None-Match")).toBeNull();
      return new Response("# updated body\n", {
        status: 200,
        headers: { ETag: '"abc-123"' },
      });
    });
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(true);
    // Both adapters got the new body.
    expect(readClaudeBody()).toContain("# updated body");
    expect(readCursorBody()).toContain("# updated body");
    // ETag cached for the next run.
    const cached = fs.readFileSync(
      path.join(process.env["AGENTARIUM_HOME"]!, "skill.etag"),
      "utf-8",
    );
    expect(cached.trim()).toBe('"abc-123"');
  });

  it("304 response is a no-op", async () => {
    await installClaudeAndCursor("# stable body\n");
    fs.mkdirSync(process.env["AGENTARIUM_HOME"]!, { recursive: true });
    fs.writeFileSync(
      path.join(process.env["AGENTARIUM_HOME"]!, "skill.etag"),
      '"abc-123"',
    );
    stubFetch((_, init) => {
      const h = new Headers(init?.headers);
      expect(h.get("If-None-Match")).toBe('"abc-123"');
      // 304 responses are body-less; constructing Response(null, ...)
      // is the spec-compliant way (a non-null body throws).
      return new Response(null, { status: 304 });
    });
    const beforeBody = readClaudeBody();
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(false);
    expect(readClaudeBody()).toBe(beforeBody);
  });

  it("stale ETag → fetches new body, refreshes adapters, updates cache", async () => {
    await installClaudeAndCursor("# old body\n");
    fs.mkdirSync(process.env["AGENTARIUM_HOME"]!, { recursive: true });
    fs.writeFileSync(
      path.join(process.env["AGENTARIUM_HOME"]!, "skill.etag"),
      '"old-etag"',
    );
    stubFetch(() =>
      new Response("# fresh body\n", {
        status: 200,
        headers: { ETag: '"new-etag"' },
      }),
    );
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(true);
    expect(readClaudeBody()).toContain("# fresh body");
    expect(
      fs.readFileSync(path.join(process.env["AGENTARIUM_HOME"]!, "skill.etag"), "utf-8").trim(),
    ).toBe('"new-etag"');
  });

  it("does not touch adapters that are detected but not installed", async () => {
    // Install ONLY claude; cursor's home exists but no rule file.
    fs.mkdirSync(process.env["CLAUDE_CONFIG_DIR"]!, { recursive: true });
    fs.mkdirSync(process.env["CURSOR_CONFIG_DIR"]!, { recursive: true });
    const sourceTmp = path.join(tmp, "src.md");
    fs.writeFileSync(sourceTmp, "# v1\n");
    await ADAPTERS.find((a) => a.id === "claude")!.install({
      sourceSkillPath: sourceTmp,
    });
    stubFetch(() =>
      new Response("# v2\n", { status: 200, headers: { ETag: '"x"' } }),
    );
    await maybeUpdateSkill();
    expect(readClaudeBody()).toContain("# v2");
    expect(
      fs.existsSync(
        path.join(process.env["CURSOR_CONFIG_DIR"]!, "rules", "forum-skill.mdc"),
      ),
    ).toBe(false);
  });

  it("network error: returns updated=false, doesn't throw, doesn't cache anything", async () => {
    await installClaudeAndCursor("# stable\n");
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(false);
    expect(
      fs.existsSync(
        path.join(process.env["AGENTARIUM_HOME"]!, "skill.etag"),
      ),
    ).toBe(false);
  });

  it("disabled when FORUM_SKILL_NO_AUTO_UPDATE=1", async () => {
    await installClaudeAndCursor("# original\n");
    process.env["FORUM_SKILL_NO_AUTO_UPDATE"] = "1";
    let fetched = false;
    stubFetch(() => {
      fetched = true;
      return new Response("# whatever", { status: 200 });
    });
    const r = await maybeUpdateSkill();
    expect(r.updated).toBe(false);
    expect(fetched).toBe(false);
  });
});
