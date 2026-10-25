import { Suspense } from "react";
import { CommandCenter } from "@/components/intel/command-center";

export const dynamic = "force-dynamic";
export const metadata = { title: "Business Environment Command Center — JARVIS" };

/** The external business environment for Infinity Web & Apps (?briefing=daily:YYYY-MM-DD opens a briefing). */
export default function IntelPage() {
  return <Suspense fallback={<div style={{ minHeight: "calc(100dvh - 4rem)", background: "#030a14" }} />}><CommandCenter /></Suspense>;
}
