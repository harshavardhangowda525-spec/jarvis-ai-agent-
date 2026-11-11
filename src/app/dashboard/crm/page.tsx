import { JarvisCrm } from "@/components/prospects/jarvis-crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM — JARVIS" };

/** JARVIS's own CRM. `?lead=<id>` opens that lead. */
export default function CrmPage({ searchParams }: { searchParams: { lead?: string } }) {
  return <div style={{ height: "calc(100dvh - 4rem)" }}><JarvisCrm openLead={searchParams.lead ?? null} /></div>;
}
