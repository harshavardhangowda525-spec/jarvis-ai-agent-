import "server-only";
import { getDb } from "@/lib/db";
import { createJob } from "@/lib/jobs/engine";
import type { Brief } from "@/lib/jobs/brief";
import { newToken, previewPath } from "./build";
import type { CheckReport } from "./checks";
import type { SiteSpec } from "./spec";

/** ASTON's demos: list, details, change requests (a new version), approval, link rotation. */

const db = () => getDb();

export async function listSites(userId: string, take = 30) {
  const rows = await db().astonSite.findMany({ where: { userId }, orderBy: { updatedAt: "desc" }, take, include: { versions: { select: { n: true, status: true, createdAt: true }, orderBy: { n: "desc" }, take: 1 } } });
  return rows.map((s) => ({
    id: s.id, name: s.name, kind: s.kind, niche: s.niche, version: s.currentVersion, approvedVersion: s.approvedVersion,
    url: s.currentVersion ? previewPath(s.previewToken, s.currentVersion) : null, updatedAt: s.updatedAt.toISOString(),
    lastBuild: s.versions[0] ? { n: s.versions[0].n, status: s.versions[0].status, at: s.versions[0].createdAt.toISOString() } : null,
  }));
}

export interface WalkStep { id: string; title: string; say: string }

const GENERIC: Record<string, string> = {
  hero: "This is the homepage: the headline, the main call to action and the first impression.",
  top: "This is the homepage: the headline, the main call to action and the first impression.",
  about: "The about section tells the story and builds trust.",
  services: "The services section lays out what they offer, one clear card each.",
  menu: "The menu is split into tabs so it stays short on a phone.",
  features: "This section explains why customers should choose them.",
  gallery: "The gallery is ready for real photos — these tiles are placeholders.",
  pricing: "The pricing section compares the plans side by side.",
  process: "This walks a customer through how it works, step by step.",
  faq: "Frequently asked questions open one at a time.",
  hours: "Opening hours and directions.",
  cta: "A strong call to action to turn visitors into enquiries.",
  contact: "The enquiry form and contact details. In the preview the form doesn't send anything.",
  info: "Opening hours, contact details and answers to common questions.",
};

/** The walkthrough script: the sections the build really contains, with ASTON's note for each. */
export function walkSteps(spec: SiteSpec, sections: { id: string; title: string; type: string }[]): WalkStep[] {
  const notes = spec.walkthrough ?? {};
  return sections.map((s) => {
    const base = s.id.replace(/-\d+$/, "");
    const note = notes[s.id] ?? notes[base] ?? notes[s.type] ?? (s.type === "hero" ? notes.top ?? notes.hero : undefined);
    return { id: s.id, title: s.title, say: (note?.trim() || GENERIC[s.type] || GENERIC[base] || `This is the ${s.title} section.`).slice(0, 300) };
  });
}

export async function siteDetail(userId: string, id: string) {
  const s = await db().astonSite.findFirst({ where: { id, userId }, include: { versions: { orderBy: { n: "desc" }, select: { n: true, status: true, feedback: true, createdAt: true, checks: true, jobId: true } } } });
  if (!s) return null;
  const cur = s.currentVersion ? await db().astonVersion.findUnique({ where: { siteId_n: { siteId: s.id, n: s.currentVersion } }, select: { spec: true, sections: true } }) : null;
  const spec = cur?.spec as unknown as SiteSpec | undefined;
  return {
    id: s.id, name: s.name, kind: s.kind, niche: s.niche, leadId: s.leadId, version: s.currentVersion,
    approvedVersion: s.approvedVersion, approvedAt: s.approvedAt?.toISOString() ?? null,
    url: s.currentVersion ? previewPath(s.previewToken, s.currentVersion) : null,
    token: s.previewToken,
    walkthrough: spec && cur ? walkSteps(spec, cur.sections as unknown as { id: string; title: string; type: string }[]) : [],
    assumptions: spec?.assumptions ?? [],
    factsSource: spec?.facts.source ?? null,
    versions: s.versions.map((v) => {
      const rep = v.checks as unknown as CheckReport;
      return {
        n: v.n, status: v.status, feedback: v.feedback, at: v.createdAt.toISOString(), jobId: v.jobId,
        url: v.status === "ready" ? previewPath(s.previewToken, v.n) : null,
        checks: { passed: rep.checks.filter((c) => c.status === "pass").length, failed: rep.checks.filter((c) => c.status === "fail").map((c) => c.label), warnings: rep.checks.filter((c) => c.status === "warn").map((c) => c.label) },
      };
    }),
  };
}

/** A change request becomes a precise revision task for ASTON (a new version; the old one stays). */
export async function requestChanges(userId: string, siteId: string | null, feedback: string) {
  const site = siteId
    ? await db().astonSite.findFirst({ where: { id: siteId, userId } })
    : await db().astonSite.findFirst({ where: { userId, currentVersion: { gt: 0 } }, orderBy: { updatedAt: "desc" } });
  if (!site) throw new Error(siteId ? "That demo doesn't exist." : "There's no ASTON demo yet to change.");
  if (!site.currentVersion) throw new Error("That demo has no finished version yet.");
  const fb = feedback.trim().slice(0, 1500);
  const brief: Brief = {
    objective: `Revise the ${site.kind} demo for ${site.name} (version ${site.currentVersion}): ${fb}`,
    expectedOutcome: `Version ${site.currentVersion + 1} with the change applied and every check passing, plus a preview link.`,
    context: [`Current version: ${site.currentVersion}`],
    requirements: ["Apply the change request exactly", "Keep every working section and setting the change doesn't touch"],
    constraints: ["Don't publish or deploy anything", "Keep earlier versions available"],
    acceptance: ["The change is visible in the new version", "All checks pass", "A preview link to the new version"],
    approvals: [],
  };
  return createJob(userId, { agent: "aston", title: `Changes to ${site.name}`.slice(0, 120), request: fb, brief, payload: { siteId: site.id, feedback: fb } });
}

/** A new demo straight from ASTON (its own chat or the demos screen). */
export async function requestBuild(userId: string, p: { request: string; kind?: "website" | "app"; leadId?: string; business?: string }) {
  const lead = p.leadId ? await db().robinLead.findFirst({ where: { id: p.leadId, userId }, select: { id: true, businessName: true, category: true, city: true } }) : null;
  if (p.leadId && !lead) throw new Error("That CRM lead doesn't exist.");
  const who = lead?.businessName ?? p.business ?? "the business";
  const kind = p.kind ?? "website";
  const brief: Brief = {
    objective: `Build a premium, responsive ${kind === "app" ? "mobile app demo" : "website demo"} for ${who}. ${p.request}`.slice(0, 1000),
    expectedOutcome: "A checked preview link with the finished demo.",
    context: lead ? [`CRM lead: ${lead.businessName}${lead.category ? ` (${lead.category})` : ""}${lead.city ? `, ${lead.city}` : ""}`] : [],
    requirements: ["Clear call to action", "Mobile-friendly navigation", "Verified business details only; mark placeholders"],
    constraints: ["Don't publish, deploy or contact the business"],
    acceptance: ["Every check passes", "A preview link"],
    approvals: [],
  };
  return createJob(userId, { agent: "aston", title: `${kind === "app" ? "App" : "Website"} demo — ${who}`.slice(0, 120), request: p.request.slice(0, 2000), brief, payload: { kind, ...(lead ? { leadId: lead.id } : {}) } });
}

/** Approve a version. Approval is a record only — it never deploys or publishes anything. */
export async function approveVersion(userId: string, siteId: string, n: number) {
  const v = await db().astonVersion.findFirst({ where: { siteId, n, site: { userId } } });
  if (!v || v.status !== "ready") throw new Error("Only a finished, checked version can be approved.");
  return db().astonSite.update({ where: { id: siteId }, data: { approvedVersion: n, approvedAt: new Date() } });
}

/** New preview link — the old one stops working. */
export async function rotateLink(userId: string, siteId: string) {
  const s = await db().astonSite.findFirst({ where: { id: siteId, userId } });
  if (!s) throw new Error("That demo doesn't exist.");
  const u = await db().astonSite.update({ where: { id: siteId }, data: { previewToken: newToken() } });
  return previewPath(u.previewToken, u.currentVersion || undefined);
}
