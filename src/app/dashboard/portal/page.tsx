import { PortalPanel } from "@/components/portal/portal-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Portal — JARVIS" };

/** Your Client Portal, as JARVIS sees it. */
export default function PortalPage() {
  return <PortalPanel />;
}
