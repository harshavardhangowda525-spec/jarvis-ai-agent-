import { Suspense } from "react";
import { JobsPage } from "@/components/jobs/jobs-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent tasks — JARVIS" };

/** Tasks JARVIS delegated to the agents. `?task=<id>` opens one. */
export default function AgentTasksPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#F5F7FA" }} />}><JobsPage /></Suspense>;
}
