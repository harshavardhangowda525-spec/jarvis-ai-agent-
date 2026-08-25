import { byOpId, findSemantic } from "./find.mjs";
import { observe } from "./observe.mjs";
import { log } from "../log.mjs";

/**
 * ActionExecutor — performs a single low-level action against the current page
 * and reports what happened. Each action:
 *   - checks the manager's stop/pause flags first,
 *   - resolves the target robustly (op-id, else semantic),
 *   - retries once after re-observing if the element went stale,
 *   - never guesses wildly: if it can't resolve the target it returns an error
 *     for the brain/error-recovery to handle.
 *
 * Supported action types:
 *   navigate {url}                 — go to a URL
 *   click    {id?|target}          — click an element
 *   type     {id?|target, text, submit?} — focus + type text (optionally Enter)
 *   fill     {id?|target, text}    — set an input/textarea value
 *   press    {key}                 — keyboard key (e.g. "Enter", "Escape")
 *   select   {id?|target, value}   — choose an option in a <select>
 *   scroll   {direction}           — "down" | "up"
 *   wait     {ms?|until?}          — pause / wait for load
 *   read     {}                    — return the current observation only
 */
export async function executeAction(mgr, action) {
  if (mgr.stopped) return { ok: false, halted: true, message: "Stopped by user." };
  await waitWhilePaused(mgr);

  const page = await mgr.activePage();
  try {
    switch (action.type) {
      case "navigate": {
        const url = normalizeUrl(action.url);
        log.action(`navigate → ${url}`);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});
        return { ok: true, message: `Opened ${url}` };
      }
      case "click": {
        const loc = await resolve(page, action);
        if (!loc) return notFound(action);
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 8000 });
        return { ok: true, message: `Clicked ${describeTarget(action)}` };
      }
      case "type": {
        const loc = await resolve(page, action);
        if (!loc) return notFound(action);
        await loc.click({ timeout: 8000 }).catch(() => {});
        await loc.fill("").catch(() => {}); // clear when it's a normal input
        await loc.type(String(action.text ?? ""), { delay: 25 });
        if (action.submit) await page.keyboard.press("Enter");
        return { ok: true, message: `Typed into ${describeTarget(action)}` };
      }
      case "fill": {
        const loc = await resolve(page, action);
        if (!loc) return notFound(action);
        await loc.fill(String(action.text ?? ""), { timeout: 8000 });
        return { ok: true, message: `Filled ${describeTarget(action)}` };
      }
      case "press": {
        await page.keyboard.press(String(action.key || "Enter"));
        return { ok: true, message: `Pressed ${action.key}` };
      }
      case "select": {
        const loc = await resolve(page, action);
        if (!loc) return notFound(action);
        await loc.selectOption(String(action.value), { timeout: 8000 });
        return { ok: true, message: `Selected ${action.value}` };
      }
      case "scroll": {
        const dy = action.direction === "up" ? -800 : 800;
        await page.mouse.wheel(0, dy);
        await page.waitForTimeout(300);
        return { ok: true, message: `Scrolled ${action.direction || "down"}` };
      }
      case "wait": {
        if (action.until === "load") await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
        else await page.waitForTimeout(Math.min(Number(action.ms) || 1000, 15000));
        return { ok: true, message: "Waited" };
      }
      case "read": {
        return { ok: true, message: "Read page" };
      }
      default:
        return { ok: false, message: `Unknown action: ${action.type}` };
    }
  } catch (err) {
    // One recovery attempt: re-observe (which re-tags op-ids) and retry once.
    if (!action._retried && action.type !== "navigate") {
      log.warn(`action failed (${action.type}) — re-observing and retrying: ${short(err)}`);
      await observe(page).catch(() => {});
      return executeAction(mgr, { ...action, _retried: true });
    }
    return { ok: false, message: `Could not ${action.type}: ${short(err)}` };
  }
}

async function resolve(page, action) {
  if (action.id != null) {
    const loc = byOpId(page, action.id);
    if (await loc.count().catch(() => 0)) return loc.first();
  }
  if (action.target) return findSemantic(page, action.target);
  return null;
}

function notFound(action) {
  return { ok: false, notFound: true, message: `Couldn't find ${describeTarget(action)} on the page.` };
}

function describeTarget(action) {
  if (action.target?.name) return `"${action.target.name}"`;
  if (action.id != null) return `element #${action.id}`;
  return "the element";
}

function normalizeUrl(url) {
  if (!url) return "about:blank";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

async function waitWhilePaused(mgr) {
  while (mgr.paused && !mgr.stopped) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

const short = (e) => (e?.message || String(e)).split("\n")[0].slice(0, 160);
