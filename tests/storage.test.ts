import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dirSize, pruneBuildCache } from "../scripts/local-helpers.mjs";
import { Audit } from "../edith/src/audit.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-storage-"));

describe("bounded storage", () => {
  it("measures folders and clears the build cache only past its limit", () => {
    const root = tmp();
    const cache = path.join(root, ".next", "cache", "webpack");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "a.pack"), Buffer.alloc(3000));
    fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "x");
    expect(dirSize(path.join(root, ".next"))).toBe(3001);
    expect(pruneBuildCache(root, 5000)).toBe(0);          // under the limit: kept
    expect(fs.existsSync(cache)).toBe(true);
    expect(pruneBuildCache(root, 1000)).toBe(3000);       // over: cleared, and only the cache
    expect(fs.existsSync(cache)).toBe(false);
    expect(fs.readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8")).toBe("x");
  });

  it("ULTRON's audit log rolls over instead of growing forever", () => {
    const a = new Audit({ root: tmp() });
    const old = Audit.MAX_BYTES; Audit.MAX_BYTES = 200;
    try {
      for (let i = 0; i < 20; i++) a.record({ type: "step", n: i, pad: "x".repeat(20) });
      expect(fs.statSync(a.logFile).size).toBeLessThan(400);
      expect(fs.existsSync(a.logFile + ".old")).toBe(true);
    } finally { Audit.MAX_BYTES = old; }
  });
});
