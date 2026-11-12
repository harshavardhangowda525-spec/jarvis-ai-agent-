import type { Metadata } from "next";
import { CallerApp } from "@/components/calls/caller-app";

export const metadata: Metadata = { title: "JARVIS — Calls" };
export const dynamic = "force-dynamic";

/** JARVIS's calling window — JARVIS's helper on your laptop opens it by itself (no orb). */
export default function CallsLivePage() {
  return <CallerApp />;
}
