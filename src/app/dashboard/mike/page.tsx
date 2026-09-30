import { MikeConsole } from "@/components/console/mike/mike-console";

export const dynamic = "force-dynamic";
export const metadata = { title: "MIKE — JARVIS" };

/**
 * MIKE — Market Intelligence & Knowledge Engine. Evidence-based market
 * analysis from real data; a decision-support system, never a profit promise.
 */
export default function MikePage() {
  return <MikeConsole />;
}
