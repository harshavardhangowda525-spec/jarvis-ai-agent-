import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { log } from "../log.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROFILE = path.resolve(__dirname, "../../browser-data");

/**
 * BrowserManager — owns a single persistent, HEADED Chromium context so the
 * user's real logins persist across runs and every action is visible.
 *
 * Security/UX notes:
 *  - Uses a persistent profile directory (browser-data/) so cookies/sessions
 *    the user establishes by logging in MANUALLY are reused. We never store or
 *    type passwords ourselves.
 *  - Headed only. There is no headless path — the whole point is visibility.
 */
export class BrowserManager {
  constructor({ profileDir = DEFAULT_PROFILE, executablePath } = {}) {
    this.profileDir = profileDir;
    this.executablePath = executablePath || process.env.OPERATOR_CHROME_PATH || undefined;
    this.context = null;
    this.page = null;
    /** Hard stop flag — checked between every action. */
    this.stopped = false;
    /** Pause flag — when true the session waits (used for Take Control). */
    this.paused = false;
  }

  async launch() {
    if (this.context) return this.context;
    fs.mkdirSync(this.profileDir, { recursive: true });
    log.info(`Launching visible browser (profile: ${this.profileDir})`);
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: false,
      viewport: null, // use the real window size
      executablePath: this.executablePath,
      args: ["--start-maximized", "--disable-blink-features=AutomationControlled"],
      ignoreDefaultArgs: ["--enable-automation"],
    });
    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    // If the user closes the operator's page, don't crash — reopen lazily.
    this.context.on("close", () => { this.context = null; this.page = null; });
    return this.context;
  }

  /** The active page, launching the browser on first use. */
  async activePage() {
    if (!this.context) await this.launch();
    if (!this.page || this.page.isClosed()) {
      const pages = this.context.pages();
      this.page = pages[pages.length - 1] ?? (await this.context.newPage());
    }
    return this.page;
  }

  /** Bring a fresh tab to the front (used when opening a new app cleanly). */
  async newPage() {
    if (!this.context) await this.launch();
    this.page = await this.context.newPage();
    return this.page;
  }

  stop() { this.stopped = true; }
  reset() { this.stopped = false; this.paused = false; }

  async close() {
    try { await this.context?.close(); } catch { /* ignore */ }
    this.context = null;
    this.page = null;
  }
}
