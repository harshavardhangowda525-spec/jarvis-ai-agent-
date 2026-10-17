import { Suspense } from "react";
import { CrmPage } from "@/components/crm/crm-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "DARWIN CRM — JARVIS" };

/** DARWIN's CRM — the one CRM (RUBEN's "Open CRM" shows the same screen). */
export default function DarwinCrmPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#F5F7FA" }} />}><CrmPage /></Suspense>;
}
