/**
 * Matching a spoken app name ("vs code", "chrome") to an installed app's name.
 * Pure and dependency-free: ULTRON uses it to launch apps, and the JARVIS page
 * uses the same rules to decide instantly whether "open spotify" means the
 * installed app or the website.
 */

/** "Microsoft® Word 2019 (64-bit)" → "word" */
export function normalizeName(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[®™©]/g, "")
    .replace(/\((x64|x86|64-bit|32-bit|64 bit|32 bit|user|preview)\)/g, " ")
    .replace(/\b(microsoft|app|application|program|desktop|for windows|the|my)\b/g, " ")
    .replace(/\b(19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** What people say → the app's usual name. */
export const ALIASES = {
  "vs code": "visual studio code", vscode: "visual studio code", code: "visual studio code", "v s code": "visual studio code",
  chrome: "google chrome", "google chrome browser": "google chrome", edge: "edge", firefox: "firefox",
  calc: "calculator", calculator: "calculator",
  cmd: "command prompt", "command line": "command prompt", terminal: "terminal", powershell: "windows powershell",
  "file explorer": "file explorer", explorer: "file explorer", files: "file explorer", "my computer": "file explorer", "this pc": "file explorer", "file manager": "file explorer",
  "task manager": "task manager", "control panel": "control panel",
  "windows settings": "settings", "pc settings": "settings", "system settings": "settings", "computer settings": "settings", "laptop settings": "settings",
  "snipping tool": "snipping tool", "screenshot tool": "snipping tool", "screen snip": "snipping tool",
  store: "store", "microsoft store": "store", "app store": "store",
  ppt: "powerpoint", "power point": "powerpoint", "ms word": "word", "ms excel": "excel", "ms teams": "teams",
  whatsapp: "whatsapp", "whats app": "whatsapp", "spotify music": "spotify", "vlc player": "vlc media player", vlc: "vlc media player",
  "sticky note": "sticky notes", alarms: "clock", alarm: "clock", "voice recorder": "sound recorder",
  "android studio": "android studio", "git bash": "git bash", obs: "obs studio",
};

// Uninstallers, readmes and web links in the Start menu are never what you meant.
export const JUNK = /\b(uninstall|uninstaller|readme|read me|help|documentation|release notes|license|website|web site|manual|changelog|support)\b/;

export function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

/** How well an installed app's name matches what was asked (0 = not at all). */
export function matchScore(query, appName) {
  const q = normalizeName(ALIASES[normalizeName(query)] ?? query);
  const raw = normalizeName(query);
  const n = normalizeName(appName);
  if (!q || !n) return 0;
  if (JUNK.test(n) && !JUNK.test(q)) return 0;
  if (n === q || n === raw) return 100;
  const qt = q.split(" "), nt = n.split(" ");
  if (n.startsWith(q + " ")) return 92 - Math.min(10, nt.length - qt.length);
  if (qt.every((t) => nt.includes(t))) return 84 - Math.min(10, nt.length - qt.length);
  if (q.length >= 4 && nt.some((t) => t === q)) return 80;
  if (q.length >= 4 && n.includes(q)) return 70;
  const d = lev(q, n);
  if ((q.length >= 4 && d <= 1) || (q.length >= 7 && d <= 2)) return 62;
  return 0;
}

/** Best installed app for a request, or suggestions when nothing fits. */
export function findApp(query, apps) {
  const scored = apps.map((a) => ({ a, s: matchScore(query, a.name) })).filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.name.length - y.a.name.length);
  if (scored.length && scored[0].s >= 62) return { app: scored[0].a, score: scored[0].s };
  const q = normalizeName(query);
  const suggestions = apps
    .map((a) => ({ a, d: lev(q, normalizeName(a.name)) }))
    .filter((x) => x.d <= Math.max(2, Math.floor(q.length / 3)) && !JUNK.test(normalizeName(x.a.name)))
    .sort((x, y) => x.d - y.d).slice(0, 3).map((x) => x.a.name);
  return { app: null, suggestions };
}
