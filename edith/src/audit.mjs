/**
 * Append-only audit log + lightweight project/task memory, persisted to disk
 * (JSONL / JSON) under the workspace's .edith/ folder. Real events only. The
 * audit log is capped at 2 MB plus one previous file.
 */
import fs from "node:fs";
import path from "node:path";

export class Audit {
  static MAX_BYTES = 2 * 1024 * 1024;

  constructor(ws) {
    this.dir = path.join(ws.root, ".edith");
    fs.mkdirSync(this.dir, { recursive: true });
    this.logFile = path.join(this.dir, "audit.jsonl");
    this.memFile = path.join(this.dir, "memory.json");
  }

  record(event) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    try {
      // bounded: past 2 MB the log becomes audit.jsonl.old (one previous file kept)
      if (fs.existsSync(this.logFile) && fs.statSync(this.logFile).size > Audit.MAX_BYTES) fs.renameSync(this.logFile, this.logFile + ".old");
      fs.appendFileSync(this.logFile, line + "\n");
    } catch { /* never break the run */ }
  }

  loadMemory() {
    try { return JSON.parse(fs.readFileSync(this.memFile, "utf8")); }
    catch { return { project: null, framework: null, lastTask: null, recentChanges: [], notes: [] }; }
  }

  saveMemory(mem) {
    try { fs.writeFileSync(this.memFile, JSON.stringify(mem, null, 2)); } catch { /* ignore */ }
  }
}
