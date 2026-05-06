import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  hasMarkerBlock,
  removeMarkerBlock,
  upsertMarkerBlock,
  __test__,
} from "../src/adapters/markerBlock.js";

let tmp: string;
let target: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fs-marker-"));
  target = path.join(tmp, "AGENTS.md");
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("upsertMarkerBlock", () => {
  it("creates the file with our fenced block when it does not exist", async () => {
    await upsertMarkerBlock(target, "# Forum skill body");
    const out = fs.readFileSync(target, "utf-8");
    expect(out).toContain(__test__.BEGIN);
    expect(out).toContain("# Forum skill body");
    expect(out).toContain(__test__.END);
  });

  it("appends to an existing file without trampling user content", async () => {
    fs.writeFileSync(target, "# My existing notes\n\nSome stuff.\n");
    await upsertMarkerBlock(target, "# Forum skill body");
    const out = fs.readFileSync(target, "utf-8");
    expect(out).toContain("# My existing notes");
    expect(out).toContain("Some stuff.");
    expect(out).toContain("# Forum skill body");
  });

  it("replaces an existing block on re-run rather than duplicating", async () => {
    await upsertMarkerBlock(target, "# v1");
    await upsertMarkerBlock(target, "# v2");
    const out = fs.readFileSync(target, "utf-8");
    expect(out).toContain("# v2");
    expect(out).not.toContain("# v1");
    // Only one BEGIN sentinel.
    expect(out.match(new RegExp(__test__.BEGIN, "g"))!.length).toBe(1);
  });

  it("creates parent directories", async () => {
    const nested = path.join(tmp, "a", "b", "AGENTS.md");
    await upsertMarkerBlock(nested, "body");
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("removeMarkerBlock", () => {
  it("removes only our block, leaving user content intact", async () => {
    fs.writeFileSync(target, "# Mine\n");
    await upsertMarkerBlock(target, "# Forum");
    await removeMarkerBlock(target);
    const out = fs.readFileSync(target, "utf-8");
    expect(out).toContain("# Mine");
    expect(out).not.toContain("# Forum");
    expect(out).not.toContain(__test__.BEGIN);
  });

  it("deletes the file when removal leaves it empty", async () => {
    await upsertMarkerBlock(target, "# only-block");
    await removeMarkerBlock(target);
    expect(fs.existsSync(target)).toBe(false);
  });

  it("succeeds when nothing is installed", async () => {
    await expect(removeMarkerBlock(target)).resolves.not.toThrow();
  });
});

describe("hasMarkerBlock", () => {
  it("returns false on empty / missing file", async () => {
    expect(await hasMarkerBlock(target)).toBe(false);
  });
  it("returns true after upsert", async () => {
    await upsertMarkerBlock(target, "x");
    expect(await hasMarkerBlock(target)).toBe(true);
  });
});
