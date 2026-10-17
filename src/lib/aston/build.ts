import "server-only";
import { randomBytes } from "node:crypto";
import type { AgentJob, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { agentConfigs, type AgentEvent, type AgentInput } from "@/lib/ai/agent";
import type { AiConfig } from "@/lib/env";
import { DARWIN_BUSINESS } from "@/lib/darwin/config";
import { briefSchema, type Brief } from "@/lib/jobs/brief";
import { draftSchema, factsSchema, PALETTE_NAMES, type Draft, type Facts, type SiteSpec } from "./spec";
import { renderSite } from "./render";
import { checkHtml, type CheckReport } from "./checks";

/**
 * ASTON builds website and app demos. Its model writes the content as a site
 * spec; the renderer builds the page; the checks must pass before a preview
 * is offered. Every build (and every change request) is a new version, so an
 * earlier working version is never lost. Nothing is deployed or sent anywhere.
 */

export type AstonPayload = { siteId?: string; feedback?: string; leadId?: string; kind?: "website" | "app" };

export const newToken = () => randomBytes(18).toString("base64url");
export const previewPath = (token: string, version?: number) => `/p/${token}${version ? `?v=${version}` : ""}`;

/** First JSON object in a model reply (fenced or not). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const src = fenced ?? text;
  const start = src.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the reply");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(src.slice(start, i + 1));
  }
  throw new Error("the JSON in the reply was cut off");
}

const SECTION_GUIDE = `Section types (use 4–8, in a sensible order; "contact" near the end):
- about {title, body, highlights[]}
- services {title, intro?, items[{name, desc, price?}]}
- menu {title, intro?, categories[{name, items[{name, desc?, price?}]}]}   (cafés, restaurants, bakeries)
- features {title, items[{title, desc, icon?}]}   (icon = one emoji)
- gallery {title, items[{caption, emoji?}]}   (3–8 tiles; rendered as photo placeholders)
- pricing {title, intro?, plans[{name, price?, period?, features[], featured?}]}
- process {title, steps[{title, desc}]}
- faq {title, items[{q, a}]}
- hours {title}   (shows verified opening hours, or a placeholder)
- cta {title, body?, button{label, action}}
- contact {title, body?, fields[]}   fields from: name, phone, email, date, time, guests, service, message
CTA actions: enquire, call, whatsapp, book, menu, services, directions.`;

export function astonSystemPrompt() {
  return `You are ASTON, the website and app designer at ${DARWIN_BUSINESS.name}. You write the content and structure of premium, conversion-focused demo websites and app prototypes for local businesses. A renderer turns your JSON into the finished, responsive page, so you only write JSON.

Rules:
- Use ONLY facts given to you for the business (name, location, contact, hours, offer). Never invent phone numbers, emails, addresses, prices, awards, ratings, reviews, testimonials, years in business or statistics.
- No prices unless they were given to you. Leave "price" out instead.
- Menu or service items you suggest without being told are examples: say so in "assumptions" (e.g. "Menu items are examples — replace with the real menu").
- Write warm, specific, natural copy for this exact business and niche. No filler, no lorem ipsum, no "[placeholder]" text — the renderer marks missing details itself.
- palette: one of ${PALETTE_NAMES.join(", ")} (pick what suits the business). font: modern | elegant | friendly | bold.
- kind: "website" or "app" (an app = a mobile app prototype with screens).
- "walkthrough": one short spoken sentence per section type you used (keys = section types, plus "top" for the homepage), explaining the design choice.

${SECTION_GUIDE}

Reply with ONE JSON object only:
{"kind","businessName","niche","tagline","palette","font","hero":{"eyebrow?","headline","sub","primary":{"label","action"},"secondary?":{"label","action"}},"sections":[...],"walkthrough":{...},"assumptions":[...]}`;
}

function briefText(title: string, b: Brief) {
  const list = (h: string, xs: string[]) => (xs.length ? `${h}:\n${xs.map((x) => `- ${x}`).join("\n")}` : "");
  return [
    `Task: ${title}`, `Objective: ${b.objective}`, `Expected outcome: ${b.expectedOutcome}`,
    list("Known facts", b.context), list("Requirements", b.requirements), list("Constraints", b.constraints),
    b.deadline ? `Deadline: ${b.deadline}` : "", list("Done when", b.acceptance),
  ].filter(Boolean).join("\n\n");
}

/** Verified facts: the CRM lead's record, plus details written in the brief itself. */
export async function gatherFacts(userId: string, p: AstonPayload, text: string, businessName?: string): Promise<{ facts: Facts; leadId: string | null }> {
  const db = getDb();
  const lead = p.leadId
    ? await db.robinLead.findFirst({ where: { id: p.leadId, userId } })
    : businessName && businessName.length >= 3
      ? await db.robinLead.findFirst({ where: { userId, businessName: { equals: businessName.trim(), mode: "insensitive" } }, orderBy: { updatedAt: "desc" } })
      : null;
  const fromBrief = factsFromText(text);
  const facts = factsSchema.parse({
    phone: lead?.phone ?? fromBrief.phone, whatsapp: lead?.whatsapp ?? undefined, email: lead?.email ?? fromBrief.email,
    address: lead?.address ?? undefined, city: lead?.city ?? undefined, mapsUrl: lead?.mapsUrl ?? undefined,
    instagram: lead?.instagram ?? fromBrief.instagram, website: lead?.website ?? undefined, hours: fromBrief.hours,
    source: lead ? `CRM lead${lead.number ? ` #${lead.number}` : ""} (${lead.businessName})` : Object.values(fromBrief).some((v) => (Array.isArray(v) ? v.length : v)) ? "your brief" : undefined,
  });
  return { facts, leadId: lead?.id ?? null };
}

/** Contact details literally present in the brief (never guessed). */
export function factsFromText(text: string): { phone?: string; email?: string; instagram?: string; hours: { days: string; time: string }[] } {
  const phone = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/.exec(text)?.[0];
  const email = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.exec(text)?.[0];
  const ig = /(?:instagram[:\s]+|\big[:\s]+)(@?[A-Za-z0-9._]{2,30})/i.exec(text)?.[1] ?? /instagram\.com\/([A-Za-z0-9._]{2,30})/i.exec(text)?.[1];
  const instagram = ig?.replace(/\.+$/, ""); // a sentence's full stop isn't part of the handle
  const hours: { days: string; time: string }[] = [];
  const DAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
  const re = new RegExp(`\\b(${DAY}(?:\\s*(?:-|–|to)\\s*${DAY})?|daily|every day|weekdays|weekends)\\b[:,]?\\s*(\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(?:-|–|to)\\s*\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?)`, "gi");
  for (const m of text.matchAll(re)) if (hours.length < 7) hours.push({ days: cap(m[1]), time: m[2].replace(/\s*(?:-|to)\s*/, " – ") });
  return { phone, email, instagram, hours };
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Ask = (system: string, user: string) => Promise<string>;

/** Ask the model for a draft; one repair round if the JSON doesn't fit the schema. */
export async function writeDraft(ask: Ask, user: string): Promise<{ draft: Draft; repaired: boolean }> {
  const system = astonSystemPrompt();
  let reply = await ask(system, user);
  for (let round = 0; ; round++) {
    let problem: string;
    try {
      const r = draftSchema.safeParse(extractJson(reply));
      if (r.success) return { draft: r.data, repaired: round > 0 };
      problem = r.error.issues.slice(0, 8).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) { problem = (e as Error).message; }
    if (round >= 1) throw new Error(`ASTON's model didn't return a valid site (${problem.slice(0, 200)}).`);
    reply = await ask(system, `${user}\n\nYour previous reply couldn't be used: ${problem}. Reply again with the complete, corrected JSON object only.`);
  }
}

export interface BuildResult { siteId: string; version: number; token: string; url: string; report: CheckReport; spec: SiteSpec; sections: { id: string; title: string; type: string }[]; placeholders: string[]; name: string }

/**
 * Build (or revise) a site: draft → verified facts → render → checks → save.
 * A failing build is saved as a failed version (so you can see why) and throws.
 */
export async function buildSite(userId: string, o: { title: string; brief: Brief; payload: AstonPayload; jobId?: string; ask: Ask; onStep?: (ok: boolean, text: string) => void | Promise<void> }): Promise<BuildResult> {
  const db = getDb();
  const step = async (ok: boolean, text: string) => { await o.onStep?.(ok, text); };
  const site = o.payload.siteId ? await db.astonSite.findFirst({ where: { id: o.payload.siteId, userId } }) : null;
  if (o.payload.siteId && !site) throw new Error("That demo doesn't exist any more.");
  const prev = site ? await db.astonVersion.findFirst({ where: { siteId: site.id, status: "ready" }, orderBy: { n: "desc" } }) : null;
  if (site && !prev) throw new Error("That demo has no working version to change yet.");
  const text = briefText(o.title, o.brief);

  let user: string;
  if (prev) {
    const cur = prev.spec as unknown as SiteSpec;
    const { facts: _f, ...draftOnly } = cur;
    void _f;
    user = `Revise this ${cur.kind} for ${cur.businessName}. Apply the change request exactly; keep every other section, text and setting that isn't affected.\n\nChange request:\n${o.payload.feedback ?? o.brief.objective}\n\nCurrent site JSON:\n${JSON.stringify(draftOnly)}\n\n${text}`;
  } else {
    user = `${text}\n\nBuild a ${o.payload.kind ?? "website"} demo for this business.`;
  }
  const { draft, repaired } = await writeDraft(o.ask, user);
  await step(true, `Wrote the ${draft.kind === "app" ? "app screens" : "page content"} (${draft.sections.length} sections${repaired ? ", after one correction" : ""})`);

  const { facts, leadId } = await gatherFacts(userId, { ...o.payload, leadId: o.payload.leadId ?? site?.leadId ?? undefined }, `${text}\n${o.payload.feedback ?? ""}`, draft.businessName);
  // a revision keeps the verified facts it already had unless new ones arrived
  const prevFacts = prev ? (prev.spec as unknown as SiteSpec).facts : null;
  const merged = factsSchema.parse({ ...(prevFacts ?? {}), ...Object.fromEntries(Object.entries(facts).filter(([, v]) => (Array.isArray(v) ? v.length : v))) });
  const spec: SiteSpec = { ...draft, kind: site ? (site.kind as SiteSpec["kind"]) : (o.payload.kind ?? draft.kind), facts: merged };

  const rendered = renderSite(spec, { agency: DARWIN_BUSINESS.name });
  const report = checkHtml(rendered.html, { palette: spec.palette });
  const failed = report.checks.filter((c) => c.status === "fail");
  await step(report.passed, report.passed
    ? `Built and checked the page — ${report.checks.filter((c) => c.status === "pass").length} checks passed`
    : `Checks failed: ${failed.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ""}`).join("; ")}`);

  const target = site ?? await db.astonSite.create({
    data: { userId, name: spec.businessName.slice(0, 120), kind: spec.kind, niche: spec.niche.slice(0, 60), leadId, previewToken: newToken() },
  });
  const n = (await db.astonVersion.aggregate({ where: { siteId: target.id }, _max: { n: true } }))._max.n ?? 0;
  const version = await db.astonVersion.create({
    data: {
      siteId: target.id, n: n + 1, status: report.passed ? "ready" : "failed", spec: spec as unknown as Prisma.InputJsonValue,
      html: rendered.html, sections: rendered.sections as unknown as Prisma.InputJsonValue, checks: report as unknown as Prisma.InputJsonValue,
      feedback: o.payload.feedback ?? null, jobId: o.jobId ?? null,
    },
  });
  if (!report.passed) throw new Error(`The build didn't pass its checks: ${failed.map((c) => c.label).join(", ")}. Version ${version.n} was kept for inspection; no preview was offered.`);
  await db.astonSite.update({ where: { id: target.id }, data: { currentVersion: version.n, name: spec.businessName.slice(0, 120) } });
  return {
    siteId: target.id, version: version.n, token: target.previewToken, url: previewPath(target.previewToken, version.n), report, spec,
    sections: rendered.sections, placeholders: rendered.placeholders, name: spec.businessName,
  };
}

/** The ASTON job runner (used by the job engine instead of the chat loop). */
export function astonRunner(job: Pick<AgentJob, "id" | "userId" | "title" | "brief" | "payload">) {
  return async function* (input: AgentInput): AsyncGenerator<AgentEvent, void, unknown> {
    const payload = (job.payload ?? {}) as AstonPayload;
    const brain = await getLiveBrain(job.userId).catch(() => null);
    const pick = agentConfigs("aston", brain);
    if (!pick.configs.length) { yield { type: "error", message: pick.missing ?? "ASTON has no AI provider." }; return; }
    const ask: Ask = (system, user) => completeWithFallback(pick.configs as AiConfig[], system, user, { maxTokens: 6000, timeoutMs: 120_000 });
    yield { type: "activity", label: payload.siteId ? "ASTON is revising the demo" : "ASTON is designing the demo" };
    const steps: { ok: boolean; text: string }[] = [];
    let res: BuildResult;
    try {
      res = await buildSite(job.userId, {
        title: job.title, brief: briefSchema.parse(job.brief), payload, jobId: job.id, ask,
        onStep: (ok, text) => { steps.push({ ok, text }); },
      });
    } catch (e) {
      for (const s of steps.splice(0)) yield { type: "tool", name: "aston_build", status: s.ok ? "ok" : "error", summary: s.text };
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      yield { type: "text", delta: `I couldn't finish the demo. ${msg}\n\nSTATUS: BLOCKED — ${msg}` };
      return;
    }
    for (const s of steps) yield { type: "tool", name: "aston_build", status: s.ok ? "ok" : "error", summary: s.text };
    yield { type: "tool", name: "aston_build", status: "ok", summary: `Saved version ${res.version} — preview ready` };
    yield { type: "artifact", kind: "aston", siteId: res.siteId, version: res.version, url: res.url, title: res.name };
    yield { type: "link", url: res.url, label: `Preview — ${res.name} v${res.version}` };
    const assumptions = res.spec.assumptions;
    const text = [
      `${payload.siteId ? "Updated" : "Built"} the ${res.spec.kind === "app" ? "app demo" : "website demo"} for ${res.name} (version ${res.version}).`,
      `Sections: ${res.sections.map((s) => s.title).join(", ")}.`,
      `Checks: ${res.report.checks.filter((c) => c.status === "pass").length} passed${res.report.checks.some((c) => c.status === "warn") ? `, ${res.report.checks.filter((c) => c.status === "warn").length} warnings` : ""}.`,
      res.placeholders.length ? `Placeholders still to confirm: ${res.placeholders.join(", ")}.` : "All contact details came from verified data.",
      assumptions.length ? `Assumptions: ${assumptions.join("; ")}.` : "",
      `Preview: ${res.url} (a private preview — nothing is published or sent).`,
      "STATUS: DONE",
    ].filter(Boolean).join("\n");
    void input;
    yield { type: "done", text };
  };
}
