import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { targets, sizeOf, mb } from "../scripts/clean.mjs";

describe("npm run clean (pure parts)", () => {
  it("only ever touches caches and leftovers — never settings, data, sign-ins, the voice or models", () => {
    const all = (targets("/j", "/appdata", "/local") as { paths: string[] }[]).flatMap((t) => t.paths);
    expect(all).toContain(path.join("/j", ".next", "cache"));
    expect(all).toContain(path.join("/j", "operator", "browser-data", "Default/Cache"));
    expect(all).toContain(path.join("/appdata", "JARVIS Orb", "GPUCache"));
    for (const p of all) {
      expect(p).not.toMatch(/\.env|Cookies|Login Data|Local Storage|IndexedDB|\.ollama|tools[\\/]voice[\\/](models|piper|node_modules|hf-cache)|prisma|SoundVolumeView/);
      expect(p === "/j" || p === path.join("/j", "operator", "browser-data")).toBe(false);
    }
  });
  it("measures sizes", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "jclean-"));
    fs.mkdirSync(path.join(d, "a"));
    fs.writeFileSync(path.join(d, "a", "x.bin"), Buffer.alloc(2048));
    fs.writeFileSync(path.join(d, "y.bin"), Buffer.alloc(1024));
    expect(sizeOf(d)).toBe(3072);
    expect(sizeOf(path.join(d, "missing"))).toBe(0);
    expect(mb(3 * 1024 * 1024)).toBe("3.0 MB");
    fs.rmSync(d, { recursive: true, force: true });
  });
});
