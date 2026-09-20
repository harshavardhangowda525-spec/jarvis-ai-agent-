import { EdithPanel } from "@/components/console/edith-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "EDITH — JARVIS" };

/**
 * EDITH — JARVIS's software-development subagent. Drives the local EDITH runtime
 * that performs real file/terminal/git/build/deploy work on the user's machine.
 */
export default function EdithPage() {
  return <EdithPanel />;
}
