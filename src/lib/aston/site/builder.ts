import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { redact } from "@/lib/activity/redact";
import { recordActivity } from "@/lib/activity/record";
import { AstonAiUnavailable, groqChat, groqStream, type GroqDeps } from "../groq";
import { assembleSite, cleanCss, cleanHtml, extractGuide, extractJson, normalizePlan, type SitePlan, type SiteSection } from "./assemble";
import { cssPrompt, planPrompt, revisePickPrompt, revisePrompt, sectionPrompt } from "./prompts";

/**
 * ASTON's website builder. A build is a sequence of small steps — plan →
 * stylesheet → one section at a time — each streamed live to the owner and
 * saved when it finishes. Small steps keep every request inside Groq's free
 * per-minute budget; when Groq says "wait", the build pauses and resumes from
 * the last saved step (also after a restart).
 */

type Row = Prisma.AstonSiteGetPayload<object>;

export type StepInfo = { kind: "plan" | "css" | "section"; id?: string; title: string; file: string; index: number; total: number };
export type BuildEvent =
  | { t: "step"; step: StepInfo }
  | { t: "d"; d: string }
  | { t: "saved"; site: SiteDTO }
  | { t: "complete"; site: SiteDTO }
  | { t: "wait"; until: string; message: string }
  | { t: "error"; message: string };

export interface SiteDTO {
  id: string; title: string; brief: string; status: string; error: string | null;
  plan: SitePlan | null; css: string | null; sections: SiteSection[];
  revisions: number; startedAt: string; completedAt: string | null;
}

export class SiteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const LOCK_MS = 4 * 60_000;
const TOKENS = { plan: 2500, css: 6000, section: 3500, revise: 6000 };

export function toSiteDTO(r: Row): SiteDTO {
  return {
    id: r.id, title: r.title, brief: r.brief, status: r.status, error: r.error,
    plan: (r.plan as SitePlan | null) ?? null, css: r.css, sections: (r.sections as unknown as SiteSection[] | null) ?? [],
    revisions: r.revisions, startedAt: r.startedAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
  };
}

export async function createSite(userId: string, brief: string): Promise<SiteDTO> {
  const clean = redact(brief.trim()).slice(0, 2000);
  if (clean.length < 8) throw new SiteError("Tell ASTON a little more about the website (what business, what style).");
  const row = await getDb().astonSite.create({ data: { userId, brief: clean, title: clean.slice(0, 60) } });
  await recordActivity(userId, { category: "development", agent: "ASTON", source: "aston", status: "info", action: `ASTON started building a website: ${row.title}`, importance: 3 });
  return toSiteDTO(row);
}

export async function getSite(userId: string, id: string): Promise<Row> {
  const row = await getDb().astonSite.findFirst({ where: { id, userId } });
  if (!row) throw new SiteError("Website not found.", 404);
  return row;
}

export async function listSites(userId: string) {
  const rows = await getDb().astonSite.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, title: true, status: true, createdAt: true, completedAt: true } });
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }));
}

/** The finished (or partial) single-file website. */
export function siteHtml(r: Row): string {
  return assembleSite({ plan: (r.plan as SitePlan | null) ?? null, css: r.css, sections: (r.sections as unknown as SiteSection[] | null) ?? null, building: r.status !== "done" });
}

async function lock(userId: string, id: string): Promise<boolean> {
  const now = new Date();
  const r = await getDb().astonSite.updateMany({
    where: { id, userId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return r.count === 1;
}
const unlock = (id: string) => getDb().astonSite.update({ where: { id }, data: { lockedUntil: null } });

function fail(e: unknown, emit: (ev: BuildEvent) => void): string {
  if (e instanceof AstonAiUnavailable && e.until && ["rate_limited", "quota_exhausted", "outage"].includes(e.reason)) {
    emit({ t: "wait", until: e.until.toISOString(), message: e.message });
    return e.message;
  }
  const message = e instanceof AstonAiUnavailable ? e.message : e instanceof SiteError ? e.message : "This step failed — press Resume to try it again.";
  if (!(e instanceof AstonAiUnavailable) && !(e instanceof SiteError)) console.error("[aston] site step failed:", redact(String((e as Error)?.message ?? e)));
  emit({ t: "error", message });
  return message;
}

/** Run the next pending step of a build, streaming it through `emit`. */
export async function nextStep(userId: string, id: string, emit: (ev: BuildEvent) => void, deps?: Partial<GroqDeps>): Promise<void> {
  const db = getDb();
  let row = await getSite(userId, id);
  if (row.status === "done") { emit({ t: "complete", site: toSiteDTO(row) }); return; }
  if (!(await lock(userId, id))) { emit({ t: "error", message: "ASTON is already working on this website." }); return; }
  try {
    row = await getSite(userId, id);
    const plan = (row.plan as SitePlan | null) ?? null;
    const sections = (row.sections as unknown as SiteSection[] | null) ?? [];
    const total = 2 + (sections.length || 7);
    const onDelta = (d: string) => emit({ t: "d", d });

    if (!plan) {
      emit({ t: "step", step: { kind: "plan", title: "Planning the site", file: "plan.json", index: 1, total } });
      const text = await groqStream({ messages: planPrompt(row.brief), max_tokens: TOKENS.plan, temperature: 0.7 }, onDelta, { deps });
      let parsed;
      try { parsed = normalizePlan(extractJson(text)); }
      catch { throw new SiteError("The design plan came back unreadable — press Resume to plan again."); }
      row = await db.astonSite.update({ where: { id }, data: { plan: parsed.plan as unknown as object, sections: parsed.sections as unknown as object, title: parsed.plan.siteName, error: null } });
    } else if (!row.css) {
      emit({ t: "step", step: { kind: "css", title: "Designing the style system", file: "styles.css", index: 2, total } });
      const text = await groqStream({ messages: cssPrompt(row.brief, plan, sections), max_tokens: TOKENS.css, temperature: 0.6 }, onDelta, { deps });
      const css = cleanCss(text);
      if (css.length < 200) throw new SiteError("The stylesheet came back empty — press Resume to try again.");
      row = await db.astonSite.update({ where: { id }, data: { css, guide: extractGuide(css), error: null } });
    } else {
      const i = sections.findIndex((s) => !s.html);
      if (i >= 0) {
        const s = sections[i];
        emit({ t: "step", step: { kind: "section", id: s.id, title: `Writing ${s.title}`, file: `${s.id}.html`, index: 3 + i, total } });
        const text = await groqStream({ messages: sectionPrompt(row.brief, plan, sections, row.guide ?? "", s), max_tokens: TOKENS.section, temperature: 0.7 }, onDelta, { deps });
        const html = cleanHtml(text);
        if (!/^<(section|footer)\b/i.test(html)) throw new SiteError(`"${s.title}" came back malformed — press Resume to rewrite it.`);
        const next = sections.map((x, k) => (k === i ? { ...x, html } : x));
        const done = next.every((x) => x.html);
        row = await db.astonSite.update({ where: { id }, data: { sections: next as unknown as object, error: null, ...(done ? { status: "done", completedAt: new Date() } : {}) } });
        if (done) {
          await recordActivity(userId, { category: "development", agent: "ASTON", source: "aston", status: "success", action: `ASTON finished a website: ${row.title}`, result: `${Math.round((row.completedAt!.getTime() - row.startedAt.getTime()) / 1000)} s`, importance: 3 });
        }
      }
    }
    if (row.status === "done") emit({ t: "complete", site: toSiteDTO(row) });
    else emit({ t: "saved", site: toSiteDTO(row) });
  } catch (e) {
    const message = fail(e, emit);
    await db.astonSite.update({ where: { id }, data: { error: message.slice(0, 500) } }).catch(() => {});
  } finally {
    await unlock(id).catch(() => {});
  }
}

/** Apply a change request to a finished site: pick the part, rewrite it live. */
export async function reviseSite(userId: string, id: string, instruction: string, emit: (ev: BuildEvent) => void, deps?: Partial<GroqDeps>): Promise<void> {
  const db = getDb();
  const row = await getSite(userId, id);
  if (row.status !== "done") { emit({ t: "error", message: "Let ASTON finish the website first." }); return; }
  if (!(await lock(userId, id))) { emit({ t: "error", message: "ASTON is already working on this website." }); return; }
  try {
    const plan = row.plan as unknown as SitePlan;
    const sections = row.sections as unknown as SiteSection[];
    const ask = redact(instruction.trim()).slice(0, 800);
    const pick = await groqChat({ messages: revisePickPrompt(ask, sections), response_format: { type: "json_object" }, max_tokens: 400, temperature: 0 }, { deps });
    let target = "css";
    try { target = String((extractJson(pick.choices[0]?.message?.content ?? "") as { target?: string }).target ?? "css"); } catch { /* default to css */ }
    const s = sections.find((x) => x.id === target);
    const onDelta = (d: string) => emit({ t: "d", d });
    if (!s) {
      emit({ t: "step", step: { kind: "css", title: "Restyling the site", file: "styles.css", index: 1, total: 1 } });
      const css = cleanCss(await groqStream({ messages: revisePrompt(ask, "css", row.css ?? "", plan, ""), max_tokens: TOKENS.revise, temperature: 0.5 }, onDelta, { deps }));
      if (css.length < 200) throw new SiteError("The new stylesheet came back empty — nothing was changed.");
      const updated = await db.astonSite.update({ where: { id }, data: { css, guide: extractGuide(css) || row.guide, revisions: { increment: 1 }, error: null } });
      emit({ t: "complete", site: toSiteDTO(updated) });
      return;
    }
    emit({ t: "step", step: { kind: "section", id: s.id, title: `Updating ${s.title}`, file: `${s.id}.html`, index: 1, total: 1 } });
    const html = cleanHtml(await groqStream({ messages: revisePrompt(ask, "section", s.html ?? "", plan, row.guide ?? ""), max_tokens: TOKENS.section, temperature: 0.6 }, onDelta, { deps }));
    if (!/^<(section|footer)\b/i.test(html)) throw new SiteError("The updated section came back malformed — nothing was changed.");
    const updated = await db.astonSite.update({ where: { id }, data: { sections: sections.map((x) => (x.id === s.id ? { ...x, html } : x)) as unknown as object, revisions: { increment: 1 }, error: null } });
    emit({ t: "complete", site: toSiteDTO(updated) });
  } catch (e) {
    fail(e, emit);
  } finally {
    await unlock(id).catch(() => {});
  }
}

/** Stream build events to the browser as newline-delimited JSON. */
export function ndjson(run: (emit: (ev: BuildEvent) => void) => Promise<void>): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: BuildEvent) => { try { controller.enqueue(enc.encode(JSON.stringify(ev) + "\n")); } catch { /* client went away; the step still saves */ } };
      try { await run(emit); }
      catch (e) { emit({ t: "error", message: e instanceof SiteError ? e.message : "Something went wrong." }); }
      finally { try { controller.close(); } catch { /* already closed */ } }
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
