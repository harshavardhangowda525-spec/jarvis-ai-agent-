import { OperatorPanel } from "@/components/console/operator-panel";

export const dynamic = "force-dynamic";

export const metadata = { title: "Operator — JARVIS" };

/**
 * Browser Operator cockpit. Drives the local JARVIS Operator service that
 * controls a real, visible browser on the user's machine.
 */
export default function OperatorPage() {
  return <OperatorPanel />;
}
