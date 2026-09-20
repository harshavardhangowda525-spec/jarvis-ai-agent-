/**
 * Real filesystem tools, confined to the workspace. Every operation actually
 * reads/writes the disk — nothing is simulated. Returns structured results the
 * agent and UI report verbatim.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const MAX_READ = 200_000; // chars returned to the model

export function makeFsTools(ws, onChange) {
  const change = (kind, rel) => onChange?.({ kind, path: rel });

  return {
    async list({ dir = "." } = {}) {
      const abs = ws.resolve(dir);
      const entries = await fsp.readdir(abs, { withFileTypes: true }).catch(() => { throw new Error(`Not a directory: ${dir}`); });
      return {
        dir: ws.display(abs),
        entries: entries
          .filter((e) => e.name !== "node_modules" && e.name !== ".git")
          .map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })),
      };
    },

    async read({ file }) {
      const abs = ws.resolve(file);
      const st = await fsp.stat(abs).catch(() => { throw new Error(`File not found: ${file}`); });
      if (st.isDirectory()) throw new Error(`${file} is a directory.`);
      const buf = await fsp.readFile(abs, "utf8");
      return { file: ws.display(abs), bytes: st.size, truncated: buf.length > MAX_READ, content: buf.slice(0, MAX_READ) };
    },

    async write({ file, content }) {
      const abs = ws.resolve(file);
      const existed = fs.existsSync(abs);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content ?? "", "utf8");
      change(existed ? "modified" : "created", ws.display(abs));
      return { file: ws.display(abs), action: existed ? "modified" : "created", bytes: Buffer.byteLength(content ?? "") };
    },

    /** Exact-string replacement in a file (like a surgical edit). */
    async edit({ file, find, replace, all = false }) {
      const abs = ws.resolve(file);
      const buf = await fsp.readFile(abs, "utf8").catch(() => { throw new Error(`File not found: ${file}`); });
      if (!buf.includes(find)) throw new Error(`The text to replace was not found in ${file}.`);
      const occurrences = buf.split(find).length - 1;
      if (!all && occurrences > 1) throw new Error(`"find" matches ${occurrences} places in ${file}; set all=true or make it unique.`);
      const next = all ? buf.split(find).join(replace) : buf.replace(find, replace);
      await fsp.writeFile(abs, next, "utf8");
      change("modified", ws.display(abs));
      return { file: ws.display(abs), action: "modified", replacements: all ? occurrences : 1 };
    },

    async remove({ file }) {
      const abs = ws.resolve(file);
      if (!fs.existsSync(abs)) throw new Error(`Not found: ${file}`);
      await fsp.rm(abs, { recursive: true, force: true });
      change("deleted", ws.display(abs));
      return { file: ws.display(abs), action: "deleted" };
    },

    async move({ from, to }) {
      const a = ws.resolve(from), b = ws.resolve(to);
      await fsp.mkdir(path.dirname(b), { recursive: true });
      await fsp.rename(a, b);
      change("deleted", ws.display(a));
      change("created", ws.display(b));
      return { from: ws.display(a), to: ws.display(b), action: "moved" };
    },

    /** Recursive text search across the workspace (skips node_modules/.git). */
    async search({ query, glob }) {
      const root = ws.root;
      const results = [];
      const walk = async (dir) => {
        const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === ".next") continue;
          const p = path.join(dir, e.name);
          if (e.isDirectory()) { await walk(p); continue; }
          if (glob && !new RegExp(globToRe(glob)).test(e.name)) continue;
          const text = await fsp.readFile(p, "utf8").catch(() => null);
          if (text == null) continue;
          const lines = text.split("\n");
          lines.forEach((ln, i) => {
            if (ln.includes(query)) results.push({ file: ws.display(p), line: i + 1, text: ln.trim().slice(0, 200) });
          });
          if (results.length > 200) throw { done: true };
        }
      };
      try { await walk(root); } catch (e) { if (!e?.done) throw e; }
      return { query, matches: results.slice(0, 200) };
    },
  };
}

function globToRe(glob) {
  return "^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
}
