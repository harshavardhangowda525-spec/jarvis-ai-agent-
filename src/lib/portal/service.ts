import "server-only";
import postgres from "postgres";

/**
 * JARVIS ↔ your Client Portal (Infinity Web & Apps). JARVIS connects to the
 * portal's own Postgres (CLIENT_PORTAL_DATABASE_URL — kept only in .env.local)
 * and works as your portal ADMIN account, inside the portal's Row Level
 * Security, exactly like the portal itself: it reads projects, milestones,
 * invoices, payments, client messages and requests, and when YOU ask it to
 * reply to a client, it posts the message, notifies the client and writes the
 * audit log the same way the portal does. It never records payments, changes
 * proposals or invoices, or touches anything else.
 */
export class PortalError extends Error {}
type Sql = postgres.Sql;
type Tx = postgres.TransactionSql<Record<string, unknown>>;

const g = globalThis as unknown as { __portalSql?: Sql; __portalUrl?: string };

export function portalUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const u = (env.CLIENT_PORTAL_DATABASE_URL || "").trim();
  return u || null;
}
export const portalConfigured = () => !!portalUrl();

function sql(): Sql {
  const url = portalUrl();
  if (!url) throw new PortalError("The Client Portal isn't connected — add CLIENT_PORTAL_DATABASE_URL (the portal's Neon connection string) to .env.local and restart JARVIS.");
  if (!g.__portalSql || g.__portalUrl !== url) {
    g.__portalSql = postgres(url, {
      max: 3, idle_timeout: 20, connect_timeout: 15, prepare: !/pooler|pgbouncer/.test(url),
      types: {
        numeric: { to: 1700, from: [1700], serialize: (v: unknown) => String(v), parse: (v: string) => Number(v) },
        date: { to: 1082, from: [1082], serialize: (v: unknown) => String(v), parse: (v: string) => v },
      },
    });
    g.__portalUrl = url;
  }
  return g.__portalSql;
}

/** For tests: point at another database. */
export async function _resetPortal() { if (g.__portalSql) await g.__portalSql.end({ timeout: 2 }).catch(() => {}); g.__portalSql = undefined; g.__portalUrl = undefined; }

type Admin = { id: string; name: string; email: string };
let adminCache: { at: number; admin: Admin } | null = null;

/** The portal admin account JARVIS acts as (CLIENT_PORTAL_ADMIN_EMAIL, else the first active admin). */
async function admin(): Promise<Admin> {
  if (adminCache && Date.now() - adminCache.at < 10 * 60_000) return adminCache.admin;
  const want = (process.env.CLIENT_PORTAL_ADMIN_EMAIL || "").trim().toLowerCase();
  const rows = await sql().begin(async (tx) => {
    await tx`select set_config('app.role', 'system', true)`;
    return tx<Admin[]>`select id, name, email from users where role = 'admin' and disabled_at is null order by created_at asc`;
  });
  const a = (want && rows.find((r) => r.email.toLowerCase() === want)) || rows[0];
  if (!a) throw new PortalError("The portal has no active admin account for JARVIS to work as.");
  adminCache = { at: Date.now(), admin: a };
  return a;
}

/** Run as your portal admin, inside the portal's Row Level Security. */
async function asAdmin<T>(fn: (tx: Tx, a: Admin) => Promise<T>): Promise<T> {
  const a = await admin();
  return sql().begin(async (tx) => {
    await tx`select set_config('app.role', 'admin', true), set_config('app.user_id', ${a.id}, true), set_config('app.client_id', '', true)`;
    return fn(tx as unknown as Tx, a);
  }) as Promise<T>;
}

/** Weighted share of completed milestones — the portal's own formula. Pure (tested). */
export function progressOf(ms: { status: string; weight: number }[]): number {
  const total = ms.reduce((s, m) => s + Number(m.weight), 0);
  if (total <= 0) return 0;
  return Math.round((ms.filter((m) => m.status === "completed").reduce((s, m) => s + Number(m.weight), 0) / total) * 100);
}
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

export interface PortalProject {
  id: string; name: string; client: string; owner: string | null; type: string; status: string; stage: string | null;
  progress: number; nextMilestone: string | null; nextDue: string | null; overdue: number; target: string | null;
  unread: number; balance: number;
}

/** Everything at a glance: projects with progress, money owed, what's waiting for you. */
export async function portalOverview() {
  return asAdmin(async (tx, a) => {
    const projects = await tx<{ id: string; name: string; project_type: string; status: string; current_stage: string | null; target_delivery_date: string | null; business_name: string; owner_name: string | null }[]>`
      select p.id, p.name, p.project_type, p.status, p.current_stage, p.target_delivery_date, c.business_name, c.owner_name
      from projects p join client_profiles c on c.id = p.client_id
      where p.cancelled_at is null and c.archived_at is null and not p.is_sample
      order by p.updated_at desc limit 50`;
    const ids = projects.map((p) => p.id);
    const ms = ids.length ? await tx<{ project_id: string; title: string; status: string; weight: number; due_date: string | null; position: number }[]>`
      select project_id, title, status, weight, due_date, position from milestones where project_id = any(${ids}::uuid[]) order by position` : [];
    const unread = ids.length ? await tx<{ project_id: string; n: number }[]>`
      select c.project_id, count(*)::int n from comments c join users u on u.id = c.author_id and u.role = 'client'
      where c.project_id = any(${ids}::uuid[]) and c.target_type = 'thread'
        and c.created_at > coalesce((select last_read_messages_at from project_members m where m.project_id = c.project_id and m.user_id = ${a.id}), '-infinity')
      group by c.project_id` : [];
    const money = ids.length ? await tx<{ project_id: string; invoice_id: string; number: string; title: string; amount: number; due_date: string | null; paid: number }[]>`
      select i.project_id, i.id invoice_id, i.number, i.title, i.amount, i.due_date,
        coalesce((select sum(p.amount) from payments p where p.invoice_id = i.id and p.status = 'confirmed'), 0)::numeric paid
      from invoices i where i.project_id = any(${ids}::uuid[]) and i.status not in ('void', 'draft')` : [];
    const [counts] = await tx<{ tickets: number; approvals: number; payments_to_confirm: number }[]>`
      select (select count(*)::int from resolve_tickets where status not in ('resolved', 'closed')) tickets,
             (select count(*)::int from approval_requests where status = 'pending') approvals,
             (select count(*)::int from payments where status = 'pending') payments_to_confirm`;
    const today = istToday();
    const out: PortalProject[] = projects.map((p) => {
      const m = ms.filter((x) => x.project_id === p.id);
      const next = m.find((x) => x.status !== "completed");
      const owed = money.filter((x) => x.project_id === p.id).reduce((s, x) => s + Math.max(0, Number(x.amount) - Number(x.paid)), 0);
      return {
        id: p.id, name: p.name, client: p.business_name, owner: p.owner_name, type: p.project_type, status: p.status, stage: p.current_stage,
        progress: progressOf(m), nextMilestone: next?.title ?? null, nextDue: next?.due_date ?? null,
        overdue: m.filter((x) => x.status !== "completed" && x.due_date && x.due_date < today).length, target: p.target_delivery_date,
        unread: unread.find((u) => u.project_id === p.id)?.n ?? 0, balance: owed,
      };
    });
    const dues = money.filter((x) => Number(x.amount) - Number(x.paid) > 0.5).map((x) => ({
      invoice: x.number, title: x.title, project: projects.find((p) => p.id === x.project_id)?.name ?? "", client: projects.find((p) => p.id === x.project_id)?.business_name ?? "",
      balance: Number(x.amount) - Number(x.paid), due: x.due_date, overdue: !!x.due_date && x.due_date < today,
    }));
    return {
      projects: out,
      unreadMessages: out.reduce((s, p) => s + p.unread, 0),
      openRequests: counts.tickets, pendingApprovals: counts.approvals, paymentsToConfirm: counts.payments_to_confirm,
      outstanding: dues.reduce((s, d) => s + d.balance, 0), dues,
    };
  });
}

/** Find a project by its name or the client's business / owner name. Pure (tested). */
export function pickProject<T extends { name: string; client: string; owner: string | null }>(q: string, projects: T[]): T | T[] | null {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const w = n(q);
  if (!w) return null;
  const exact = projects.filter((p) => n(p.name) === w || n(p.client) === w || (p.owner && n(p.owner) === w));
  if (exact.length === 1) return exact[0];
  const hits = projects.filter((p) => [p.name, p.client, p.owner ?? ""].some((s) => n(s).includes(w) || (w.length >= 3 && w.split(" ").every((t) => n(s).includes(t)))));
  return hits.length === 1 ? hits[0] : hits.length ? hits.slice(0, 5) : null;
}

async function resolveProject(q: string) {
  const o = await portalOverview();
  const hit = pickProject(q, o.projects);
  if (!hit) throw new PortalError(`I couldn't find a portal project for "${q}".${o.projects.length ? ` Projects: ${o.projects.slice(0, 8).map((p) => `${p.name} (${p.client})`).join(", ")}.` : ""}`);
  if (Array.isArray(hit)) throw new PortalError(`Which one — ${hit.map((p) => `${p.name} (${p.client})`).join(", ")}?`);
  return hit;
}

/** One project in detail: milestones, recent messages, invoices, open requests. */
export async function portalProject(q: string) {
  const p = await resolveProject(q);
  return asAdmin(async (tx) => {
    const milestones = await tx<{ title: string; status: string; due_date: string | null; blocked_reason: string | null }[]>`
      select title, status, due_date, blocked_reason from milestones where project_id = ${p.id} order by position`;
    const messages = await tx<{ body: string; created_at: Date; name: string | null; role: string | null }[]>`
      select c.body, c.created_at, u.name, u.role from comments c left join users u on u.id = c.author_id
      where c.project_id = ${p.id} and c.target_type = 'thread' order by c.created_at desc limit 8`;
    const invoices = await tx<{ number: string; title: string; amount: number; status: string; due_date: string | null; paid: number }[]>`
      select i.number, i.title, i.amount, i.status, i.due_date,
        coalesce((select sum(x.amount) from payments x where x.invoice_id = i.id and x.status = 'confirmed'), 0)::numeric paid
      from invoices i where i.project_id = ${p.id} and i.status not in ('void', 'draft') order by i.created_at`;
    const requests = await tx<{ number: string; title: string; status: string; priority: string | null; scope_assessment: string | null }[]>`
      select number, title, status, priority, scope_assessment from resolve_tickets where project_id = ${p.id} and status not in ('resolved', 'closed') order by created_at desc limit 8`;
    return {
      project: p,
      milestones,
      messages: messages.reverse().map((m) => ({ from: m.role === "client" ? `${m.name ?? "Client"} (client)` : (m.name ?? "Team"), text: m.body, at: m.created_at })),
      invoices: invoices.map((i) => ({ number: i.number, title: i.title, amount: Number(i.amount), paid: Number(i.paid), balance: Math.max(0, Number(i.amount) - Number(i.paid)), status: i.status, due: i.due_date })),
      openRequests: requests,
    };
  });
}

/** You asked JARVIS to reply to a client: posted in the project's Messages, the client notified, the audit log written — like the portal does. */
export async function portalReply(q: string, body: string) {
  const text = body.replace(/\s+\n/g, "\n").trim().slice(0, 4000);
  if (!text) throw new PortalError("What should I write to them?");
  const p = await resolveProject(q);
  return asAdmin(async (tx, a) => {
    const [c] = await tx<{ id: string }[]>`
      insert into comments (project_id, target_type, target_id, author_id, body) values (${p.id}, 'thread', null, ${a.id}, ${text}) returning id`;
    await tx`insert into project_members (project_id, user_id, member_role, last_read_messages_at) values (${p.id}, ${a.id}, 'manager', now())
             on conflict (project_id, user_id) do update set last_read_messages_at = now()`;
    const members = await tx<{ id: string }[]>`
      select u.id from project_members m join users u on u.id = m.user_id where m.project_id = ${p.id} and u.role = 'client' and u.disabled_at is null`;
    const snippet = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    if (members.length) {
      await tx`insert into notifications ${tx(members.map((m) => ({ user_id: m.id, project_id: p.id, type: "message", title: `New message from ${a.name}`, body: snippet, link: `/portal/${p.id}/messages` })))}`;
    }
    await tx`insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, project_id, data)
             values (${a.id}, 'admin', 'message.sent_by_jarvis', 'comment', ${c.id}, ${p.id}, ${tx.json({ via: "JARVIS" } as never)})`;
    return { project: p.name, client: p.client, notified: members.length, commentId: c.id };
  });
}

export interface PortalEvent { ref: string; kind: "message" | "request" | "approval" | "payment"; project: string; client: string; text: string; at: Date }

/** What came in from clients since a time (for JARVIS's watch). */
export async function portalInbox(since: Date): Promise<PortalEvent[]> {
  return asAdmin(async (tx) => {
    const msgs = await tx<{ id: string; body: string; created_at: Date; name: string | null; project: string; client: string }[]>`
      select c.id, c.body, c.created_at, u.name, p.name project, cp.business_name client
      from comments c join users u on u.id = c.author_id and u.role = 'client' join projects p on p.id = c.project_id join client_profiles cp on cp.id = p.client_id
      where c.created_at > ${since} order by c.created_at limit 30`;
    const tickets = await tx<{ id: string; number: string; title: string; created_at: Date; project: string | null; client: string }[]>`
      select t.id, t.number, t.title, t.created_at, p.name project, cp.business_name client
      from resolve_tickets t join client_profiles cp on cp.id = t.client_id left join projects p on p.id = t.project_id
      where t.created_at > ${since} order by t.created_at limit 20`;
    const approvals = await tx<{ id: string; title: string; status: string; responded_at: Date; project: string; client: string }[]>`
      select r.id, r.title, r.status, r.responded_at, p.name project, cp.business_name client
      from approval_requests r join projects p on p.id = r.project_id join client_profiles cp on cp.id = p.client_id
      where r.responded_at > ${since} order by r.responded_at limit 20`;
    const pays = await tx<{ id: string; amount: number; created_at: Date; project: string; client: string }[]>`
      select x.id, x.amount, x.created_at, p.name project, cp.business_name client
      from payments x join projects p on p.id = x.project_id join client_profiles cp on cp.id = p.client_id
      where x.status = 'pending' and x.created_at > ${since} order by x.created_at limit 20`;
    return [
      ...msgs.map((m) => ({ ref: `comment:${m.id}`, kind: "message" as const, project: m.project, client: m.client, text: `${m.name ?? "Client"}: ${m.body}`, at: m.created_at })),
      ...tickets.map((t) => ({ ref: `ticket:${t.id}`, kind: "request" as const, project: t.project ?? "", client: t.client, text: `New request ${t.number}: ${t.title}`, at: t.created_at })),
      ...approvals.map((r) => ({ ref: `approval:${r.id}:${r.status}`, kind: "approval" as const, project: r.project, client: r.client, text: `${r.status === "approved" ? "Approved" : r.status === "changes_requested" ? "Asked for changes on" : `Responded (${r.status}) to`}: ${r.title}`, at: r.responded_at })),
      ...pays.map((x) => ({ ref: `payment:${x.id}`, kind: "payment" as const, project: x.project, client: x.client, text: `Reported a payment of ${inr(Number(x.amount))} — confirm it in the portal`, at: x.created_at })),
    ].sort((a, b) => +a.at - +b.at);
  });
}
