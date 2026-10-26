import "server-only";
import type { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { recordActivity } from "@/lib/activity/record";
import { cancelJob, createJob, markAnnounced, resumeJob, retryJob } from "@/lib/jobs/engine";
import { JOB_AGENTS, JOB_AGENT_NAME, type JobAgent } from "@/lib/jobs/brief";
import { darwinMessageTool } from "@/lib/tools/darwin/message";
import { emailChannelReady } from "@/lib/darwin/email";
import { applyAction, currentPackage, dailyConfig } from "@/lib/ev/daily/pipeline";
import { localClock } from "@/lib/ev/daily/schedule";

/**
 * The Approval & Activity Center: everything that is waiting for YOU, gathered
 * from where it really lives (tasks paused for approval, DARWIN's outreach
 * drafts, EV's content package, proposals from EVIE, failed tasks, finished
 * tasks you haven't reviewed). Opening it approves nothing; each decision is
 * carried out through the owning system and written to ApprovalDecision.
 */

const db = () => getDb();
export type ItemKind = "job" | "darwin_message" | "ev_daily" | "proposal" | "failed_job" | "review";
export type Decision = "approve" | "reject" | "revise" | "retry" | "reviewed";

export interface CenterItem {
  kind: ItemKind; id: string; agent: string; title: string;
  proposes: string; effect: string; permission: string;
  preview?: { label: string; text: string }[];
  links?: { url: string; label: string }[];
  createdAt: string;
  actions: Decision[];
}

const lastApprovalText = (p: unknown) => {
  const arr = Array.isArray(p) ? (p as { text?: string; kind?: string }[]) : [];
  return [...arr].reverse().find((s) => s.kind === "approval")?.text ?? arr[arr.length - 1]?.text ?? "";
};

export async function listCenter(userId: string) {
  const now = new Date();
  const [waiting, drafts, proposals, failed, review, decisions] = await Promise.all([
    db().agentJob.findMany({ where: { userId, status: "waiting_approval" }, orderBy: { updatedAt: "desc" } }),
    db().darwinMessage.findMany({ where: { userId, status: "approval_required" }, orderBy: { createdAt: "desc" }, take: 30, include: { lead: { select: { businessName: true, email: true, instagram: true } } } }),
    db().proposal.findMany({ where: { userId, status: "pending" }, orderBy: { createdAt: "desc" } }),
    db().agentJob.findMany({ where: { userId, status: "failed", finishedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) }, announcedAt: null }, orderBy: { finishedAt: "desc" }, take: 20 }),
    db().agentJob.findMany({ where: { userId, status: "completed", announcedAt: null }, orderBy: { finishedAt: "desc" }, take: 20 }),
    db().approvalDecision.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const items: CenterItem[] = [];
  for (const j of waiting) items.push({
    kind: "job", id: j.id, agent: j.agent, title: j.title,
    proposes: lastApprovalText(j.progress) || "The agent stopped and is asking for your OK to continue.",
    effect: `${JOB_AGENT_NAME[j.agent as JobAgent] ?? j.agent} continues this task with your approval (and your note, if you add one).`,
    permission: ((j.brief as { approvals?: string[] }).approvals ?? []).join("; ") || "Steps that send, publish or contact anyone need your OK.",
    links: [{ url: `/dashboard/jobs?task=${j.id}`, label: "Task details" }],
    createdAt: j.updatedAt.toISOString(), actions: ["approve", "revise", "reject"],
  });
  const canEmail = drafts.length ? await emailChannelReady(userId).catch(() => false) : false;
  for (const m of drafts) {
    const to = m.channel === "email" ? m.lead.email : m.lead.instagram;
    const sendable = m.channel === "email" && !!m.lead.email && canEmail;
    items.push({
      kind: "darwin_message", id: m.id, agent: "darwin", title: `${m.channel === "email" ? "Email" : "Instagram DM"} to ${m.lead.businessName}`,
      proposes: "DARWIN drafted this outreach message from the lead's real details.",
      effect: sendable ? `Approve sends it now from your Gmail to ${to}.` : m.channel !== "email" ? "Instagram DMs can't be sent from JARVIS — approving marks nothing as sent; copy it instead." : !m.lead.email ? "This lead has no email, so it can't be sent." : "Gmail isn't connected — connect Google in Settings to send it.",
      permission: "External message — sent only when you press Approve.",
      preview: [...(m.subject ? [{ label: "Subject", text: m.subject }] : []), { label: "To", text: to ?? "no address on record" }, { label: "Message", text: m.body }],
      createdAt: m.createdAt.toISOString(), actions: sendable ? ["approve", "revise", "reject"] : ["revise", "reject"],
    });
  }
  try {
    const cfg = dailyConfig();
    const p = await currentPackage(userId, localClock(now, cfg.tz).date);
    if (p && p.status === "ready") items.push({
      kind: "ev_daily", id: p.id, agent: "ev", title: `Today's Instagram content (${p.date}) — ${p.topic ?? "post"}`,
      proposes: "EV prepared today's post and is waiting for your approval before publishing.",
      effect: "Approve publishes it to your Instagram account. Reject makes a new version (your note guides it).",
      permission: "Publishing — only with your approval.",
      preview: [{ label: "Caption", text: (p.caption ?? "").slice(0, 1200) }],
      links: [{ url: "/dashboard/chat/ev?today=1", label: "Open in EV" }],
      createdAt: p.updatedAt.toISOString(), actions: ["approve", "reject"],
    });
  } catch { /* EV daily isn't set up — nothing to approve */ }
  for (const pr of proposals) items.push({
    kind: "proposal", id: pr.id, agent: pr.agent, title: pr.title,
    proposes: pr.detail, effect: `Approve creates a task for ${JOB_AGENT_NAME[pr.agent as JobAgent] ?? pr.agent}; it then runs like any task (and stops again before anything external).`,
    permission: "Creates a task only — no messages or publishing without a further approval.",
    preview: (pr.evidence as { title: string; url: string; publisher?: string }[]).map((e) => ({ label: e.publisher ?? "Source", text: `${e.title} — ${e.url}` })),
    createdAt: pr.createdAt.toISOString(), actions: ["approve", "reject"],
  });
  const attention: CenterItem[] = failed.map((j) => ({
    kind: "failed_job", id: j.id, agent: j.agent, title: j.title, proposes: j.error ?? "The task failed.", effect: "Retry runs it again from the start.", permission: "—",
    links: [{ url: `/dashboard/jobs?task=${j.id}`, label: "Task details" }], createdAt: (j.finishedAt ?? j.updatedAt).toISOString(), actions: ["retry", "reviewed"],
  }));
  const reviewItems: CenterItem[] = review.map((j) => ({
    kind: "review", id: j.id, agent: j.agent, title: j.title, proposes: (j.result ?? "").slice(0, 600), effect: "Mark as reviewed.", permission: "—",
    links: [{ url: `/dashboard/jobs?task=${j.id}`, label: "Task details" }, ...(((j.resultData as { links?: { url: string; label: string }[] } | null)?.links) ?? []).slice(0, 3)],
    createdAt: (j.finishedAt ?? j.updatedAt).toISOString(), actions: ["reviewed"],
  }));
  return {
    approvals: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    attention, review: reviewItems,
    decisions: decisions.map((d) => ({ id: d.id, kind: d.kind, refId: d.refId, decision: d.decision, note: d.note, outcome: d.outcome, detail: d.detail, at: d.createdAt.toISOString() })),
  };
}

async function record(userId: string, kind: ItemKind, refId: string, decision: Decision, note: string | null, outcome: "ok" | "failed", detail: string) {
  await db().approvalDecision.create({ data: { userId, kind, refId, decision, note, outcome, detail: detail.slice(0, 2000) } });
  void recordActivity(userId, { category: "decision", agent: "JARVIS", source: "approval-center", status: outcome === "ok" ? "success" : "failed", importance: 3, action: `${decision} · ${kind}`, result: detail.slice(0, 300) });
}

/** Carry out one decision through the system that owns the item, and record it (whatever happened). */
export async function decide(userId: string, i: { kind: ItemKind; id: string; decision: Decision; note?: string }) {
  const note = i.note?.trim() || null;
  try {
    let detail = "";
    switch (i.kind) {
      case "job":
        if (i.decision === "approve" || i.decision === "revise") {
          if (i.decision === "revise" && !note) throw new Error("Say what to change.");
          await resumeJob(userId, i.id, i.decision === "revise" ? `Approved with changes: ${note}` : note ?? "go ahead");
          detail = i.decision === "revise" ? `Approved with changes: ${note}` : "Approved — the task continues.";
        } else if (i.decision === "reject") { await cancelJob(userId, i.id); detail = "Rejected — the task was cancelled."; }
        else throw new Error("Not an option for this item.");
        break;
      case "failed_job":
        if (i.decision === "retry") { await retryJob(userId, i.id); detail = "Queued to run again."; }
        else if (i.decision === "reviewed") { await markAnnounced(userId, [i.id]); detail = "Marked as reviewed."; }
        else throw new Error("Not an option for this item.");
        break;
      case "review":
        if (i.decision !== "reviewed") throw new Error("Not an option for this item.");
        await markAnnounced(userId, [i.id]); detail = "Marked as reviewed.";
        break;
      case "darwin_message": {
        const m = await db().darwinMessage.findFirst({ where: { id: i.id, userId } });
        if (!m) throw new Error("That draft no longer exists.");
        if (m.status !== "approval_required") throw new Error(`That draft is already ${m.status}.`);
        if (i.decision === "reject") { await db().darwinMessage.update({ where: { id: m.id }, data: { status: "rejected" } }); detail = "Rejected — nothing was sent."; }
        else if (i.decision === "revise") {
          if (!note || note.length < 5) throw new Error("Paste the revised message.");
          await db().darwinMessage.update({ where: { id: m.id }, data: { body: note.slice(0, 6000) } }); detail = "Message text updated — still waiting for approval.";
        } else if (i.decision === "approve") {
          const r = await darwinMessageTool.execute({ messageId: m.id }, { userId, timezone: "Asia/Kolkata", activity: () => {} });
          detail = r.summary ?? "Sent.";
          if ((r.data as { status?: string }).status !== "sent") throw new Error(detail);
        } else throw new Error("Not an option for this item.");
        break;
      }
      case "ev_daily": {
        const cfg = dailyConfig();
        const date = localClock(new Date(), cfg.tz).date;
        if (i.decision !== "approve" && i.decision !== "reject") throw new Error("Not an option for this item.");
        const r = await applyAction(userId, date, i.decision === "approve" ? { action: "approve" } : { action: "reject", ...(note ? { instruction: note } : {}) });
        detail = r.message;
        break;
      }
      case "proposal": {
        const p = await db().proposal.findFirst({ where: { id: i.id, userId } });
        if (!p || p.status !== "pending") throw new Error("That proposal was already decided.");
        if (i.decision === "reject") { await db().proposal.update({ where: { id: p.id }, data: { status: "rejected", decidedAt: new Date() } }); detail = "Rejected — no task created."; break; }
        if (i.decision !== "approve") throw new Error("Not an option for this item.");
        if (!(JOB_AGENTS as readonly string[]).includes(p.agent)) throw new Error(`${p.agent} can't take tasks.`);
        const ev = p.evidence as { title: string; url: string; publisher?: string }[];
        const job = await createJob(userId, {
          agent: p.agent as JobAgent, title: p.title, request: p.detail,
          brief: {
            objective: p.title, expectedOutcome: "A concrete, sourced recommendation or deliverable the user can act on.",
            context: [p.detail, ...ev.map((e) => `Source: ${e.title} (${e.publisher ?? ""}) ${e.url}`), ...(note ? [`The user added: ${note}`] : [])],
            requirements: [], constraints: [], acceptance: ["Every claim cites one of the sources or the agent's own tool results", "Anything external (messages, publishing) is prepared and stopped for approval"],
            approvals: ["Sending, publishing or contacting anyone"],
          },
        });
        await db().proposal.update({ where: { id: p.id }, data: { status: "approved", decidedAt: new Date(), jobId: job.id } });
        detail = `Approved — task created for ${JOB_AGENT_NAME[p.agent as JobAgent]}.`;
        break;
      }
    }
    await record(userId, i.kind, i.id, i.decision, note, "ok", detail);
    return { ok: true as const, detail };
  } catch (e) {
    const detail = (e as Error).message ?? String(e);
    await record(userId, i.kind, i.id, i.decision, note, "failed", detail);
    return { ok: false as const, detail };
  }
}

/** EVIE → JARVIS: propose an action from an insight; nothing runs until it's approved. */
export async function propose(userId: string, p: { refKind: "intel_item" | "intel_opportunity"; refId: string; agent: JobAgent; title?: string; detail?: string }) {
  let title = p.title ?? "", detail = p.detail ?? "", evidence: { title: string; url: string; publisher: string | null }[] = [];
  if (p.refKind === "intel_item") {
    const it = await db().intelItem.findFirst({ where: { id: p.refId, userId } });
    if (!it) throw new Error("That item doesn't exist.");
    const a = it.analysis as { recommendedAction?: string; opportunity?: string } | null;
    title ||= `Act on: ${it.title}`.slice(0, 160);
    detail ||= [a?.recommendedAction, a?.opportunity].filter(Boolean).join(" ") || `Look into: ${it.title}`;
    evidence = [{ title: it.title, url: it.url, publisher: it.publisher }];
  } else {
    const o = await db().intelOpportunity.findFirst({ where: { id: p.refId, userId } });
    if (!o) throw new Error("That opportunity doesn't exist.");
    const d = o.detail as { howWeCouldUseIt?: string; whoBenefits?: string };
    title ||= `Investigate: ${o.title}`.slice(0, 160);
    detail ||= [d.howWeCouldUseIt, d.whoBenefits && `Who benefits: ${d.whoBenefits}`].filter(Boolean).join(" ");
    evidence = (o.evidence as { title: string; url: string; publisher: string | null }[]).slice(0, 6);
  }
  const existing = await db().proposal.findFirst({ where: { userId, refKind: p.refKind, refId: p.refId, status: "pending" } });
  if (existing) return existing;
  return db().proposal.create({ data: { userId, source: "ev", refKind: p.refKind, refId: p.refId, title, detail: detail.slice(0, 4000), agent: p.agent, evidence: evidence as unknown as Prisma.InputJsonValue } });
}
