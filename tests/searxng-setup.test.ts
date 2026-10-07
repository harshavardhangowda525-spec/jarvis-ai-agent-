import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { dockerDesktopPath, ensureSecret, setEnvLine, searxngAnswers } from "../scripts/searxng.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "searx-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("npm run searxng — setup helpers", () => {
  it("creates a private secret once, and never replaces it", () => {
    expect(ensureSecret(dir)).toBe(true);
    const first = fs.readFileSync(path.join(dir, ".env"), "utf8");
    expect(first).toMatch(/^SEARXNG_SECRET=[0-9a-f]{64}\n$/);
    expect(ensureSecret(dir)).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toBe(first);
  });
  it("sets SEARXNG_URL in .env.local without touching anything else", () => {
    const f = path.join(dir, ".env.local");
    fs.writeFileSync(f, 'DATABASE_URL="postgresql://u@h/db"\nGROQ_API_KEY="k"\n');
    expect(setEnvLine(f, "SEARXNG_URL", "http://localhost:8888")).toBe(true);
    expect(fs.readFileSync(f, "utf8")).toBe('DATABASE_URL="postgresql://u@h/db"\nGROQ_API_KEY="k"\nSEARXNG_URL="http://localhost:8888"\n');
    expect(setEnvLine(f, "SEARXNG_URL", "http://localhost:8888")).toBe(false); // already set
    fs.writeFileSync(f, 'SEARXNG_URL=""\nGROQ_API_KEY="k"\n');
    setEnvLine(f, "SEARXNG_URL", "http://localhost:8888");
    expect(fs.readFileSync(f, "utf8")).toBe('SEARXNG_URL="http://localhost:8888"\nGROQ_API_KEY="k"\n');
  });
  it("knows when SearXNG answers JSON, refuses it, or isn't there", async () => {
    let mode = "ok";
    const srv = http.createServer((_q, r) => {
      if (mode === "json_off") { r.statusCode = 403; return r.end("Forbidden"); }
      r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ query: "jarvis", results: [] }));
    }).listen(0);
    const port = (srv.address() as { port: number }).port;
    expect(await searxngAnswers(`http://127.0.0.1:${port}`)).toBe("ok");
    mode = "json_off";
    expect(await searxngAnswers(`http://127.0.0.1:${port}`)).toBe("json_off");
    srv.close();
    expect(await searxngAnswers("http://127.0.0.1:1", 1000)).toBe("down");
  });
  it("finds Docker Desktop where Windows and macOS install it (to start it when it's closed)", () => {
    const winExe = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
    expect(dockerDesktopPath({ ProgramFiles: "C:\\Program Files" }, "win32", (p: string) => p === winExe)).toBe(winExe);
    expect(dockerDesktopPath({ ProgramFiles: "C:\\Program Files" }, "win32", () => false)).toBeNull();
    expect(dockerDesktopPath({}, "darwin", (p: string) => p === "/Applications/Docker.app")).toBe("/Applications/Docker.app");
    expect(dockerDesktopPath({}, "linux", () => true)).toBeNull();
  });
});
