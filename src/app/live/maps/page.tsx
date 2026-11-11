import type { Metadata } from "next";
import { LiveCrm } from "@/components/prospects/live-crm";

export const metadata: Metadata = { title: "JARVIS CRM — live" };
export const dynamic = "force-dynamic";

/** The live CRM window the JARVIS Operator opens next to Google Maps (token handed over by message). */
export default function LiveMapsPage() {
  return <LiveCrm />;
}
