"use client";

import { useState } from "react";
import { Radar, Phone, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadDTO } from "@/lib/darwin/types";

/* ---------------- liquid-glass panel ---------------- */
export function GlassPanel({ title, right, children, className }: { title: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("relative rounded-2xl border border-accent/15 bg-white/[0.03] px-4 py-3 backdrop-blur-xl", className)}
      style={{ boxShadow: "0 10px 50px -24px hsl(var(--accent)/0.5), inset 0 1px 0 hsl(0 0% 100% / 0.06)" }}>
      <div className="mb-2 flex items-center gap-1.5">
        <Radar className="h-3 w-3 text-accent/70" />
        <span className="hud-label text-[10px] tracking-[0.28em] text-accent/80">{title}</span>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </div>
  );
}

/* ---------------- CRM status ---------------- */
export const STATUS_OPTIONS = [
  { id: "new", label: "NEW" },
  { id: "contacted", label: "CONTACTED" },
  { id: "follow_up", label: "FOLLOW-UP" },
  { id: "interested", label: "INTERESTED" },
  { id: "not_interested", label: "NOT INTERESTED" },
  { id: "converted", label: "CONVERTED" },
] as const;

// Older pipeline stages fold into the new CRM statuses for display.
const LEGACY: Record<string, string> = { qualified: "new", replied: "contacted", demo: "interested", proposal: "interested", negotiation: "interested", won: "converted", lost: "not_interested" };
export const normStage = (s: string) => LEGACY[s] ?? s;

const STATUS_TONE: Record<string, string> = {
  new: "border-accent/40 bg-accent/10 text-accent-bright",
  contacted: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  follow_up: "border-warning/40 bg-warning/10 text-warning",
  interested: "border-fuchsia-400/40 bg-fuchsia-400/10 text-fuchsia-300",
  not_interested: "border-white/15 bg-white/5 text-muted-foreground",
  converted: "border-success/40 bg-success/10 text-success",
};
export const statusTone = (s: string) => STATUS_TONE[normStage(s)] ?? STATUS_TONE.new;
export const statusLabel = (s: string) => STATUS_OPTIONS.find((o) => o.id === normStage(s))?.label ?? s.toUpperCase();

/* ---------------- formatting ---------------- */
export function fmtDistance(m: number | null): string | null {
  if (m == null) return null;
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}
export function fmtDate(iso: string | null, withYear = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
}
export const toDateInput = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
export function websiteHost(url: string): string {
  try { return new URL(url.startsWith("http") ? url : `https://${url}`).host.replace(/^www\./, ""); } catch { return url; }
}
export const websiteHref = (url: string) => (url.startsWith("http") ? url : `https://${url}`);

/** First number of a "a; b" list, as a tel: URI (digits and a leading + only). */
export function telHref(phone: string): string {
  const first = phone.split(/[;,/]/)[0];
  const cleaned = first.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return `tel:${cleaned}`;
}

/* ---------------- phone actions (never auto-dial) ---------------- */
export function PhoneActions({ lead, compact }: { lead: Pick<LeadDTO, "phone">; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!lead.phone) return <span className="text-[11px] italic text-muted-foreground/70">Phone unavailable</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(lead.phone!); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { /* clipboard blocked */ }
  };
  return (
    <div className={cn("flex items-center gap-1.5", compact ? "" : "flex-wrap")}>
      <span className="whitespace-nowrap font-mono text-[12px] font-medium text-foreground">{lead.phone}</span>
      <a href={telHref(lead.phone)} title={`Call ${lead.phone}`}
        className="inline-flex items-center gap-1 rounded-md border border-success/40 bg-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-success transition hover:bg-success/20">
        <Phone className="h-2.5 w-2.5" /> Call
      </a>
      <button onClick={copy} title="Copy number"
        className="inline-flex items-center gap-1 rounded-md border border-white/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-foreground/70 transition hover:border-accent/50 hover:text-accent">
        {copied ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />} {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function WebsiteBadge({ lead }: { lead: Pick<LeadDTO, "website"> }) {
  if (lead.website) {
    return <a href={websiteHref(lead.website)} target="_blank" rel="noopener noreferrer" className="block max-w-[160px] truncate text-[11px] text-accent hover:underline">{websiteHost(lead.website)}</a>;
  }
  return (
    <span title="No website is listed in the Geoapify / OpenStreetMap data. It may still have one elsewhere."
      className="inline-block rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-warning">No website</span>
  );
}
