import { Suspense } from "react";
import { PlanHome } from "@/components/aston/plan-home";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teleprompter — ASTON" };

/** Today's marketing plan in ASTON's teleprompter (?date=YYYY-MM-DD for an earlier day). */
export default function TeleprompterPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#05070c" }} />}><PlanHome /></Suspense>;
}
