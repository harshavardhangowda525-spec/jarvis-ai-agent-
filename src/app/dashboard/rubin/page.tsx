import { Suspense } from "react";
import { RobinConsole } from "@/components/console/robin/robin-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "RUBIN — JARVIS" };

/**
 * RUBIN — Sales & CRM. Turns DARWIN's leads into qualified prospects and paying
 * clients. The holographic core is Rubin's brain; the pipeline chart is its
 * sales memory. Real CRM data only.
 */
export default function RobinPage() {
  return (
    <Suspense fallback={<div className="robin-bg min-h-[100dvh]" />}>
      <RobinConsole />
    </Suspense>
  );
}
