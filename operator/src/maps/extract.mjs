/**
 * Reading Google Maps pages. Both functions run INSIDE the page (passed to
 * page.evaluate), so they must be self-contained. They read the accessible
 * attributes Maps exposes (aria-labels, data-item-id) rather than its
 * auto-generated class names, which change often.
 */

/** The result list → [{ name, href, placeId, rating, reviews }]. */
export function readFeed() {
  const num = (s) => { const m = (s || "").match(/([\d,.]+)/); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const seen = new Set(); const out = [];
  for (const a of document.querySelectorAll('div[role="feed"] a[href*="/maps/place/"]')) {
    const href = a.href; const m = href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
    const placeId = m ? m[1] : null; const key = placeId || href.split("?")[0];
    if (seen.has(key)) continue; seen.add(key);
    const card = a.closest('div[jsaction]')?.parentElement || a.parentElement;
    const stars = card?.querySelector('span[role="img"][aria-label*="star" i]')?.getAttribute("aria-label") || "";
    const r = stars.match(/([\d.]+)\s*stars?/i); const rv = stars.match(/([\d,]+)\s*review/i);
    out.push({ name: (a.getAttribute("aria-label") || "").trim(), href, placeId, rating: r ? Number(r[1]) : null, reviews: rv ? num(rv[1]) : null });
  }
  return out;
}

/** One opened listing → the facts JARVIS needs. */
export function readListing() {
  const mains = document.querySelectorAll('[role="main"]');
  const main = mains[mains.length - 1];
  if (!main) return null;
  const q = (s) => main.querySelector(s);
  const label = (s) => (q(s)?.getAttribute("aria-label") || "").trim();
  const text = (s) => (q(s)?.textContent || "").trim();
  const name = text("h1");
  const phoneId = q('[data-item-id^="phone:tel:"]')?.getAttribute("data-item-id") || "";
  const phone = phoneId.replace(/^phone:tel:/, "") || label('button[aria-label^="Phone"]').replace(/^Phone:\s*/i, "") || null;
  const web = q('a[data-item-id="authority"]')?.href || null;
  const address = label('button[data-item-id="address"]').replace(/^Address:\s*/i, "") || null;
  const category = text('button[jsaction*="category"]') || null;
  let rating = null, reviews = null;
  const starLabel = label('span[role="img"][aria-label*="star" i]');
  const rm = starLabel.match(/([\d.]+)\s*stars?/i); if (rm) rating = Number(rm[1]);
  for (const el of main.querySelectorAll("[aria-label]")) {
    const m = (el.getAttribute("aria-label") || "").match(/^([\d,]+)\s+reviews?$/i);
    if (m) { reviews = Number(m[1].replace(/,/g, "")); break; }
  }
  if (reviews == null) { const m = (q("div.F7nice")?.textContent || "").match(/\(([\d,]+)\)/); if (m) reviews = Number(m[1].replace(/,/g, "")); }
  if (rating == null) { const m = (q("div.F7nice")?.textContent || "").match(/^\s*(\d[.,]\d)/); if (m) rating = Number(m[1].replace(",", ".")); }
  const links = Array.from(main.querySelectorAll("a[href]")).map((a) => a.href);
  const instagram = links.find((h) => /instagram\.com\//i.test(h)) || (web && /instagram\.com/i.test(web) ? web : null);
  const facebook = links.find((h) => /facebook\.com\//i.test(h)) || (web && /facebook\.com/i.test(web) ? web : null);
  // the week's hours table, else the "Open · Closes 10 PM" line; nothing when only the word "Hours" shows
  const hrs = [label('div[aria-label*="Monday" i]'), label('[data-item-id="oh"]'), ...Array.from(main.querySelectorAll('[aria-label*="hours" i]')).map((e) => e.getAttribute("aria-label") || ""),
    (q('[data-item-id="oh"]')?.textContent || "")].map((h) => h.replace(/\s*·?\s*(Hide|See more|Show) (open )?hours\.?/gi, "").trim()).find((h) => /\d/.test(h));
  const hours = hrs ? hrs.slice(0, 300) : null;
  return { name, category, address, phone, website: web, rating, reviews, mapsUrl: location.href, hours, instagram, facebook };
}
