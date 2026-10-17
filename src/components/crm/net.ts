/** Small fetch helper for the CRM screens: the server's own answer, or its error (with code). */
export type Answer<T> = { ok: true; data: T } | { ok: false; error: string; status: number; code: string | null };

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<Answer<T>> {
  try {
    const r = await fetch(url, {
      method: init?.method ?? "GET", cache: "no-store",
      ...(init?.body !== undefined ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : {}),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) return { ok: false, error: j?.error || `The server answered ${r.status}.`, status: r.status, code: j?.code ?? null };
    return { ok: true, data: j.data as T };
  } catch {
    return { ok: false, error: "The CRM server isn't reachable — nothing was changed.", status: 0, code: null };
  }
}

export const safeHref = (raw: string | null | undefined, kind: "web" | "ig"): string | null => {
  if (!raw) return null;
  const s = raw.trim();
  if (kind === "ig" && !/^https?:/i.test(s)) return `https://instagram.com/${s.replace(/^@/, "").replace(/[^\w.]/g, "")}`;
  const u = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:" ? x.href : null; } catch { return null; }
};
export const waHref = (n: string | null | undefined) => { const d = (n ?? "").replace(/\D/g, ""); return d.length >= 8 ? `https://wa.me/${d.length === 10 ? `91${d}` : d}` : null; };
export const igHandle = (ig: string) => ig.replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
export const siteLabel = (w: string) => w.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
