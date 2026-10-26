import type { Metadata } from "next";
import { OrbApp } from "@/components/orb/orb-app";

export const metadata: Metadata = { title: "JARVIS Orb" };
export const dynamic = "force-dynamic";

/** The floating assistant the JARVIS desktop app shows (npm run orb). In a normal browser it's a chat with JARVIS. */
export default function OrbPage() {
  return <OrbApp />;
}
