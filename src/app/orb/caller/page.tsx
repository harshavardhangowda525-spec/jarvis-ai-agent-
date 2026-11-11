import type { Metadata } from "next";
import { CallerApp } from "@/components/calls/caller-app";

export const metadata: Metadata = { title: "JARVIS — Prospect calls" };
export const dynamic = "force-dynamic";

/** The caller the JARVIS desktop orb opens (tray → Prospect calls). */
export default function CallerPage() {
  return <CallerApp />;
}
