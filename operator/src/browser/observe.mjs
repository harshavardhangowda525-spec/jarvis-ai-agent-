/**
 * Page observation.
 *
 * Produces a compact, model-friendly snapshot of the CURRENT page so the brain
 * can decide what to do next without relying on fragile CSS selectors. Every
 * interactive, visible element is tagged with a stable `data-op-id` in the live
 * DOM; actions then target `[data-op-id="N"]`. Re-run observe() after any
 * navigation or DOM change to refresh the ids.
 */

// This function is serialized and executed INSIDE the page.
function scan() {
  const isVisible = (el) => {
    const s = window.getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 &&
      r.top < (window.innerHeight + 400) && r.left < (window.innerWidth + 400);
  };
  const accName = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const t = labelledby.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ").trim();
      if (t) return t;
    }
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab?.innerText) return lab.innerText.trim();
    }
    const ph = el.getAttribute("placeholder");
    if (ph) return ph.trim();
    const title = el.getAttribute("title");
    if (title) return title.trim();
    const txt = (el.innerText || el.value || "").trim();
    return txt.slice(0, 120);
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(t)) return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return tag;
  };

  const SEL = [
    "a[href]", "button", "input", "textarea", "select",
    '[role="button"]', '[role="link"]', '[role="textbox"]', '[role="combobox"]',
    '[role="menuitem"]', '[role="tab"]', '[role="checkbox"]', '[role="option"]',
    "[contenteditable=true]", "[onclick]",
  ].join(",");

  const seen = new Set();
  const out = [];
  let id = 0;
  document.querySelectorAll("[data-op-id]").forEach((e) => e.removeAttribute("data-op-id"));
  for (const el of document.querySelectorAll(SEL)) {
    if (seen.has(el) || !isVisible(el)) continue;
    // Skip if an ancestor is already a tagged control (avoid nested dupes).
    seen.add(el);
    const opId = id++;
    el.setAttribute("data-op-id", String(opId));
    const tag = el.tagName.toLowerCase();
    out.push({
      id: opId,
      tag,
      role: roleOf(el),
      name: accName(el),
      type: el.getAttribute("type") || undefined,
      value: (el.value ?? "").toString().slice(0, 120) || undefined,
      editable: tag === "input" || tag === "textarea" || el.isContentEditable || undefined,
    });
    if (out.length >= 150) break;
  }

  const bodyText = (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  return {
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    elements: out,
    textPreview: bodyText,
  };
}

/** Observe the current page. Returns a compact snapshot object. */
export async function observe(page) {
  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {});
  } catch { /* keep going even if still loading */ }
  const snap = await page.evaluate(scan);
  snap.loading = snap.readyState !== "complete";
  return snap;
}

/** A one-line human summary of a snapshot, for the activity log. */
export function describeState(snap) {
  const n = snap.elements.length;
  return `${snap.title || snap.url} — ${n} interactive element${n === 1 ? "" : "s"}${snap.loading ? " (loading)" : ""}`;
}
