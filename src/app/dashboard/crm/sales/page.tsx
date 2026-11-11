import { Suspense } from "react";
import { CrmPage } from "@/components/crm/crm-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "RUBIN pipeline — JARVIS" };

/** RUBIN's sales pipeline (the screen RUBIN used before JARVIS got its own CRM). */
export default function SalesPipelinePage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#F5F7FA" }} />}><CrmPage /></Suspense>;
}
