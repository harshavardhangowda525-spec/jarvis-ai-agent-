"use strict";
/**
 * JARVIS 2.0 — the hands. Carries out the planner's steps on this computer,
 * checks what really happened, and reports it honestly.
 *
 * Rules it keeps:
 * - Apps come only from the computer's own installed-app list (ULTRON's
 *   finder); windows only from those open right now. No shell, no paths from
 *   the model, no arbitrary commands: every OS call is a fixed program with
 *   its arguments passed as data.
 * - Closing an app, typing and pressing keys that could send or submit
 *   something run only after you click "Yes" in a native dialog (the page,
 *   a web page or a spoken "yes" can't answer it).
 * - Nothing is ever deleted or overwritten; a new folder is never created
 *   over an existing one.
 * - Pause stops every action until you resume; Stop ends the running command
 *   between steps.
 * - A launch counts as verified only when its window really appears.
 *
 * Everything the OS is reached through comes in `deps`, so the logic is
 * tested without a real desktop (see tests/jarvis-orb.test.ts).
 */
const path = require("node:path");
const P = require("./planner.cjs");

const labelOf = (w) => (String(w.title || "").split(" - ").pop() || w.name || "that app").trim();
const nice = (list) => (list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`);

const SKIP_DIRS = /^(node_modules|\.git|\.next|\.cache|\.npm|\.nuget|\.vscode|\.idea|dist|build|out|target|venv|\.venv|__pycache__|AppData|Application Data|Library|\$Recycle\.Bin|Windows|Program Files|Program Files \(x86\)|ProgramData|System Volume Information|snap|\.local|\.config|\.Trash)$/i;
const PROJECT_MARKERS = ["package.json", ".git", "pyproject.toml", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "composer.json", "index.html"];

function createExecutor(deps) {
  const d = {
    platform: process.platform, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: () => {}, onProgress: () => {},
    settings: () => ({}), ...deps,
  };
  let paused = false, runId = 0, aborted = 0, last = null;
  const A = d.apps; // { listApps, findApp, matchScore, normalizeName, launch(app) }
  const norm = (s) => A.normalizeName(s);
  // window control: Windows (PowerShell + user32), or Linux when wmctrl/xdotool are installed
  const W = () => d.platform === "win32" || (typeof deps.windowControl === "function" ? deps.windowControl() : deps.windowControl === true);
  const mac = d.platform === "darwin";

  // ---------------- apps & windows ----------------
  async function installed() { try { return await A.listApps(); } catch { return []; } }
  /** An installed app for a spoken name: { app } | { ambiguous: [names] } | { missing, suggestions }. */
  async function resolveApp(q) {
    const apps = await installed();
    const scored = apps.map((a) => ({ a, s: A.matchScore(q, a.name) })).filter((x) => x.s >= 62).sort((x, y) => y.s - x.s || x.a.name.length - y.a.name.length);
    if (!scored.length) {
      const f = A.findApp(q, apps);
      // "Claude Code" → the installed "Claude": an app whose whole name is part of what was asked
      const qt = norm(q).split(" ");
      const partial = apps.filter((a) => { const nt = norm(a.name).split(" ").filter(Boolean); return nt.length && nt.every((t) => qt.includes(t)); }).map((a) => a.name);
      return { missing: true, suggestions: [...new Set([...partial, ...(f.suggestions || [])])].slice(0, 3) };
    }
    const top = scored.filter((x) => x.s === scored[0].s);
    if (top.length > 1 && scored[0].s < 100) {
      const names = [...new Set(top.map((x) => x.a.name))].slice(0, 3);
      if (names.length > 1) return { ambiguous: names };
    }
    return { app: scored[0].a };
  }
  async function windows() {
    if (W()) { const r = await d.win({ op: "list" }); const list = Array.isArray(r) ? r : r && r.id ? [r] : []; return list.filter((w) => w && !(d.selfPids || []).includes(w.id)); }
    if (d.listWindows) return d.listWindows();
    return [];
  }
  function pickWindow(q, list) {
    const n = norm(q);
    if (!n) return null;
    let best = null, bestS = 0;
    for (const w of list) {
      const title = String(w.title || ""), name = String(w.name || "");
      const s = Math.max(A.matchScore(q, name), A.matchScore(q, title.split(" - ").pop() || title), norm(name) === n.replace(/\s+/g, "") ? 100 : 0, norm(title).includes(n) && n.length >= 3 ? 70 : 0);
      if (s > bestS) { best = w; bestS = s; }
    }
    return bestS >= 62 ? best : null;
  }
  async function waitForWindow(q, tries = 16) {
    for (let i = 0; i < tries; i++) {
      const w = pickWindow(q, await windows());
      if (w) return w;
      await d.sleep(600);
    }
    return null;
  }
  async function focusWindow(w) {
    const r = await d.win({ op: "focus", id: w.id });
    if (!r?.ok) return { ok: false, say: `Windows wouldn't bring ${labelOf(w)} to the front${r?.error ? `: ${r.error}` : ""}.` };
    const now = (await windows()).find((x) => x.active);
    const verified = !!now && now.id === w.id;
    return { ok: true, verified, say: verified ? `Switched to ${labelOf(w)}.` : `Asked ${labelOf(w)} to come to the front (Windows didn't confirm it).` };
  }

  // ---------------- folders & files ----------------
  const home = () => d.homedir();
  function knownFolder(name) {
    const h = home();
    if (name === "home") return h;
    const title = name.charAt(0).toUpperCase() + name.slice(1);
    const cands = [path.join(h, title), path.join(h, "OneDrive", title), path.join(h, "OneDrive - Personal", title)];
    return cands.find((p) => d.exists(p)) || null;
  }
  function roots() {
    const s = d.settings();
    const h = home();
    const extra = (s.searchRoots || []).filter((p) => typeof p === "string" && d.exists(p)).map((p) => ({ dir: p, depth: 4 }));
    const std = ["Desktop", "Documents", "Downloads", path.join("OneDrive", "Documents"), path.join("OneDrive", "Desktop"), path.join("source", "repos"), "Projects", "projects", "dev", "code", "Code", "repos", "workspace"]
      .map((r) => path.join(h, r)).filter((p) => d.exists(p)).map((p) => ({ dir: p, depth: 4 }));
    return [...extra, ...std, { dir: h, depth: 1 }];
  }
  /** Search your folders (bounded: depth, count and time) — names only, contents are never read. */
  function find(query, type, latest) {
    const q = norm(query).split(" ").filter(Boolean);
    const out = new Map();
    const started = Date.now();
    let visited = 0;
    const score = (name) => {
      const n = norm(name);
      if (!q.length || !n) return 0;
      if (n === q.join(" ")) return 100;
      if (q.every((t) => n.includes(t))) return n.startsWith(q[0]) ? 85 : 75;
      return 0;
    };
    for (const { dir, depth } of roots()) {
      const stack = [{ p: dir, depth: 0 }];
      while (stack.length) {
        if (++visited > 6000 || Date.now() - started > 4000) break;
        const { p, depth: dep } = stack.pop();
        let entries = [];
        try { entries = d.readdir(p); } catch { continue; }
        for (const e of entries) {
          if (e.name.startsWith(".") && e.name !== ".git") continue;
          const full = path.join(p, e.name);
          const isDir = e.isDirectory();
          if (isDir && SKIP_DIRS.test(e.name)) continue;
          if ((type === "file" ? !isDir : isDir)) {
            const s = score(type === "file" ? e.name.replace(/\.[^.]+$/, "") : e.name);
            if (s && !out.has(full)) {
              let mtime = 0, isProject = type !== "project";
              try { mtime = d.stat(full).mtimeMs; } catch { /* ignore */ }
              if (type === "project") { try { const kids = new Set(d.readdir(full).map((k) => k.name)); isProject = PROJECT_MARKERS.some((m) => kids.has(m)); } catch { isProject = false; } }
              if (isProject) out.set(full, { path: full, name: e.name, score: s, mtime, dir: isDir });
            }
          }
          if (isDir && dep + 1 <= depth) stack.push({ p: full, depth: dep + 1 });
        }
      }
    }
    const list = [...out.values()];
    list.sort(latest ? (a, b) => b.mtime - a.mtime : (a, b) => b.score - a.score || b.mtime - a.mtime);
    return list.slice(0, 5);
  }
  function projectAlias(name) {
    const projects = d.settings().projects || [];
    const n = norm(name);
    return projects.find((p) => p && p.path && (norm(p.name) === n || norm(p.name).includes(n) || n.includes(norm(p.name)))) || null;
  }
  async function openFolderInEditor(p) {
    const r = d.openInEditor ? await d.openInEditor(p) : { ok: false };
    if (r.ok) return { ok: true, say: `Opened ${path.basename(p)} in ${r.editor}.` };
    const e = await d.openPath(p);
    return e ? { ok: false, say: `Couldn't open ${path.basename(p)}: ${e}` } : { ok: true, say: `Opened the ${path.basename(p)} folder (VS Code wasn't found, so it's in your file manager).` };
  }

  // ---------------- each step ----------------
  async function step(s) {
    switch (s.kind) {
      case "show_apps": {
        const apps = await installed();
        return { ok: true, say: apps.length ? `Here are your ${apps.length} apps.` : "I couldn't read the list of installed apps.", launcher: apps.map((a) => a.name).sort((a, b) => a.localeCompare(b)) };
      }
      case "open_app": {
        if (W()) {
          const open = pickWindow(s.app, await windows());
          if (open) { const r = await focusWindow(open); return { ...r, say: r.ok ? `${labelOf(open)} is already open — switched to it.` : r.say }; }
        }
        const hit = await resolveApp(s.app);
        if (hit.ambiguous) return { ok: false, clarify: `Which one — ${nice(hit.ambiguous)}?`, pending: "open" };
        if (hit.missing) return { ok: false, say: `I couldn't find "${s.app}" installed on this computer.${hit.suggestions.length ? ` Did you mean ${nice(hit.suggestions)}?` : ""}` };
        const r = await A.launch(hit.app);
        if (!r.ok) return { ok: false, say: `${hit.app.name} didn't start: ${r.error}.` };
        if (!W() && !d.listWindows) return { ok: true, verified: null, say: `Opened ${hit.app.name}.` };
        const w = await waitForWindow(hit.app.name);
        return w ? { ok: true, verified: true, say: `Opened ${hit.app.name}.` } : { ok: true, verified: false, say: `Started ${hit.app.name}, but its window hasn't appeared yet.` };
      }
      case "focus": {
        if (mac && d.activate) { const hit = await resolveApp(s.app); if (!hit.app) return { ok: false, say: `I couldn't find ${s.app}.` }; const r = await d.activate(hit.app.name); return { ok: r.ok, say: r.ok ? `Switched to ${hit.app.name}.` : `Couldn't switch to ${hit.app.name}: ${r.error}` }; }
        if (!W() && !d.listWindows) return { ok: false, say: "Switching windows works on Windows (and macOS) for now." };
        const w = pickWindow(s.app, await windows());
        if (!w) return { ok: false, say: `${s.app} isn't open. Say "open ${s.app}" to start it.` };
        return focusWindow(w);
      }
      case "list_windows": {
        const names = [...new Set((await windows()).map(labelOf))].slice(0, 12);
        return { ok: true, say: names.length ? `Open now: ${nice(names)}.` : W() ? "No app windows are open." : "Listing windows works on Windows for now." };
      }
      case "active": {
        const a = (await windows()).find((w) => w.active);
        return a ? { ok: true, say: `You're in ${labelOf(a)}.` } : { ok: false, say: W() ? "I couldn't tell which app is in front." : "Telling the active app works on Windows for now." };
      }
      case "desktop": {
        if (!W()) return { ok: false, say: "Showing the desktop works on Windows for now." };
        const r = await d.win({ op: "desktop" });
        return { ok: !!r?.ok, say: r?.ok ? "Showing the desktop." : `That didn't work: ${r?.error}` };
      }
      case "window": {
        if (!W()) return { ok: false, say: `I can't ${s.op} windows on this system yet — that works on Windows.` };
        const w = pickWindow(s.app, await windows());
        if (!w) return { ok: false, say: `${s.app} isn't open.` };
        if (s.op === "close") {
          if (!(await d.confirm(`Close ${labelOf(w)}?`, "If it has unsaved work, it will ask you to save first."))) return { ok: false, cancelled: true, say: `Okay, I left ${labelOf(w)} open.` };
        }
        const r = await d.win({ op: s.op, id: w.id });
        const done = { minimize: "Minimised", maximize: "Maximised", restore: "Restored", close: "Asked to close" }[s.op];
        return { ok: !!r?.ok, say: r?.ok ? `${done} ${labelOf(w)}.` : `That didn't work: ${r?.error || "Windows refused"}.` };
      }
      case "arrange": {
        if (!W()) return { ok: false, say: "Arranging windows side by side works on Windows for now." };
        const list = await windows();
        const l = pickWindow(s.left, list), r0 = pickWindow(s.right, list);
        if (!l || !r0) return { ok: false, say: `${!l ? s.left : s.right} isn't open.` };
        const r = await d.win({ op: "arrange", left: l.id, right: r0.id });
        return { ok: !!r?.ok, say: r?.ok ? `${labelOf(l)} is on the left, ${labelOf(r0)} on the right.` : `That didn't work: ${r?.error}` };
      }
      case "new_window": case "scroll": case "type": case "key": {
        if (!W()) return { ok: false, say: "Typing and keyboard shortcuts work on Windows for now." };
        const list = await windows();
        const w = s.app ? pickWindow(s.app, list) : list.find((x) => x.active);
        if (!w) return { ok: false, say: s.app ? `${s.app} isn't open.` : `Which app? For example "${s.kind === "type" ? "type hello in Notepad" : "press control s in Word"}".` };
        const label = labelOf(w);
        const keys = s.kind === "new_window" ? "^n" : s.kind === "scroll" ? (s.dir === "up" ? "{PGUP}" : "{PGDN}") : s.kind === "type" ? P.literalKeys(s.text) : s.keys;
        if (keys.length > 2000) return { ok: false, say: "That's too much to type in one go." };
        const safe = s.kind === "new_window" || s.kind === "scroll" || (s.kind === "key" && s.safe);
        if (!safe) {
          const q = s.kind === "type" ? `Type this into ${label}?` : `Press ${String(s.label).toUpperCase()} in ${label}?`;
          const detail = s.kind === "type" ? `“${s.text.slice(0, 400)}”${/\n/.test(s.text) ? "\n\nLine breaks are typed as Enter, which can send a message." : ""}` : /ENTER/.test(keys) ? "Enter can send a message or submit a form in that app." : "";
          if (!(await d.confirm(q, detail))) return { ok: false, cancelled: true, say: "Okay, nothing was typed." };
        }
        const r = await d.win({ op: "keys", id: w.id, keys });
        const done = s.kind === "new_window" ? `Opened a new ${label} window.` : s.kind === "scroll" ? `Scrolled ${s.dir} in ${label}.` : s.kind === "type" ? `Typed it into ${label}.` : `Pressed ${s.label} in ${label}.`;
        return { ok: !!r?.ok, say: r?.ok ? done : `That didn't work: ${r?.error || "Windows refused"}.` };
      }
      case "folder": {
        const p = knownFolder(s.folder);
        if (!p) return { ok: false, say: `I couldn't find your ${s.folder} folder.` };
        const e = await d.openPath(p);
        last = { path: p, dir: true };
        return e ? { ok: false, say: `Couldn't open it: ${e}` } : { ok: true, say: `Opened your ${s.folder === "home" ? "home" : s.folder} folder.` };
      }
      case "find": {
        const found = find(s.query, s.type, s.latest);
        if (!found.length) return { ok: false, say: `I couldn't find a ${s.type} matching "${s.query}" in your usual folders. You can add folders to search in the orb's settings.` };
        last = found[0];
        const top = found.slice(0, 3).map((f) => `${f.name} (${f.path})`);
        return { ok: true, found, say: `${s.latest ? "The most recent" : "Best match"}: ${top[0]}.${found.length > 1 ? ` Also: ${top.slice(1).join("; ")}.` : ""} Say "open it" to open it.` };
      }
      case "open_last": {
        if (!last) return { ok: false, say: "Open what? Ask me to find it first, for example \"find my JARVIS project\"." };
        if (last.dir) return openFolderInEditor(last.path);
        const e = await d.openPath(last.path);
        return e ? { ok: false, say: `Couldn't open ${path.basename(last.path)}: ${e}` } : { ok: true, say: `Opened ${path.basename(last.path)} with its usual app.` };
      }
      case "project": {
        const alias = projectAlias(s.name);
        const target = alias && d.exists(alias.path) ? { path: alias.path, name: alias.name } : find(s.name, "project", false)[0];
        if (!target) return { ok: false, say: `I couldn't find your ${s.name} project. Add it in the orb's settings (name and folder) and I'll always know where it is.` };
        last = { path: target.path, dir: true };
        return openFolderInEditor(target.path);
      }
      case "url": {
        let url = s.url;
        if (!url && s.site) {
          const sites = d.settings().sites || [];
          const n = norm(s.site.replace(/\b(website|site|web ?page|homepage)\b/gi, ""));
          const hit = sites.find((x) => x && x.url && (norm(x.name) === norm(s.site) || (n && norm(x.name).includes(n))));
          if (!hit) return { ok: false, say: `I don't have a web address for your ${s.site}. Add it in the orb's settings and I'll open it next time.` };
          url = hit.url;
        }
        const safe = d.safeWebUrl(url);
        if (!safe) return { ok: false, say: "That isn't a web address I can open." };
        await d.openExternal(safe);
        return { ok: true, say: `Opened ${new URL(safe).host} in your browser.` };
      }
      case "new_folder": {
        const base = s.where ? knownFolder(s.where) : (d.settings().projectsRoot && d.exists(d.settings().projectsRoot) ? d.settings().projectsRoot : knownFolder("documents"));
        if (!base) return { ok: false, say: "I couldn't find where to put it." };
        const name = String(s.name || (s.project ? "New Project" : "New Folder")).replace(/[\\/:*?"<>|]/g, " ").replace(/\.{2,}/g, ".").replace(/\s+/g, " ").trim().slice(0, 80);
        if (!name || name === ".") return { ok: false, say: "That folder name isn't allowed." };
        const full = path.join(base, name);
        if (d.exists(full)) return { ok: false, say: `${name} already exists in ${base} — I didn't touch it.` };
        d.mkdir(full);
        last = { path: full, dir: true };
        return { ok: true, say: `Created ${full}.` };
      }
      case "screenshot": {
        if (!d.screenshot) return { ok: false, say: "Screenshots aren't available here." };
        const r = await d.screenshot();
        return r.ok ? { ok: true, say: `Screenshot saved on this computer: ${r.path}` } : { ok: false, say: `Couldn't take a screenshot: ${r.error}` };
      }
      default: return { ok: false, say: "I don't know how to do that yet." };
    }
  }

  /** Words → actions. { handled:false } means it's for JARVIS's brain. */
  async function run(text, ctx = {}) {
    const pl = P.plan(text, ctx);
    if (!pl) return { handled: false };
    if (pl.clarify) return { handled: true, clarify: pl.clarify, pending: pl.pending || null, wake: !!pl.wake, reply: pl.clarify, results: [] };
    const first = pl.steps[0];
    if (first.kind === "stop") { aborted = runId; d.log({ action: "stop" }); return { handled: true, control: "stop", reply: "Stopped.", results: [] }; }
    if (first.kind === "pause") { paused = true; aborted = runId; d.log({ action: "pause" }); return { handled: true, control: "pause", reply: "Automation paused. Say \"resume automation\" when you want me to act again.", results: [] }; }
    if (first.kind === "resume") { paused = false; d.log({ action: "resume" }); return { handled: true, control: "resume", reply: "Automation resumed.", results: [] }; }
    if (paused) return { handled: true, reply: "Automation is paused — say \"resume automation\" first.", results: [], paused: true };

    const id = ++runId;
    const results = [];
    for (let i = 0; i < pl.steps.length; i++) {
      if (aborted >= id) { results.push({ step: pl.steps[i], ok: false, say: "Stopped before this step." }); break; }
      if (paused) { results.push({ step: pl.steps[i], ok: false, say: "Paused before this step." }); break; }
      const s = pl.steps[i];
      d.onProgress({ index: i, total: pl.steps.length, step: s, state: "running" });
      let r;
      try { r = await step(s); } catch (e) { r = { ok: false, say: `Something went wrong: ${String(e && e.message || e).slice(0, 160)}` }; }
      d.log({ action: s.kind, target: s.app || s.folder || s.query || s.name || s.site || s.url || null, ok: !!r.ok, verified: r.verified ?? null, say: r.say || r.clarify });
      d.onProgress({ index: i, total: pl.steps.length, step: s, state: r.ok ? "done" : "failed", say: r.say || r.clarify });
      results.push({ step: s, ...r });
      if (r.clarify) return { handled: true, clarify: r.clarify, pending: r.pending || null, reply: [...results.slice(0, -1).map((x) => x.say), r.clarify].filter(Boolean).join(" "), results };
    }
    const launcher = results.find((r) => r.launcher)?.launcher;
    const reply = results.map((r) => r.say).filter(Boolean).join(" ");
    return { handled: true, reply, results, ok: results.every((r) => r.ok), ...(launcher ? { launcher } : {}) };
  }

  return {
    run, step, resolveApp, find, pickWindow,
    stop() { aborted = runId; },
    setPaused(on) { paused = !!on; if (paused) aborted = runId; },
    isPaused: () => paused,
    apps: async () => (await installed()).map((a) => a.name).sort((a, b) => a.localeCompare(b)),
  };
}

module.exports = { createExecutor, labelOf };
