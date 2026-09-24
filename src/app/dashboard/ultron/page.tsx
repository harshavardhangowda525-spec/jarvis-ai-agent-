import { UltronPanel } from "@/components/console/ultron-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "ULTRON — JARVIS" };

/**
 * ULTRON — JARVIS's software-development subagent. Drives the local ULTRON runtime
 * that performs real file/terminal/git/build/deploy work on the user's machine.
 */
export default function UltronPage() {
  return <UltronPanel />;
}
