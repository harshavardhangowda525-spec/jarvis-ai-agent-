import type { Metadata } from "next";
import { BiometricGate } from "@/components/gate/biometric-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JARVIS · Authentication" };

/** Same-site paths only. */
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !v.startsWith("/unlock") ? v : "/dashboard";
}

/** The biometric gate in front of JARVIS (see middleware.ts for where it's enforced). */
export default function UnlockPage({ searchParams }: { searchParams: { next?: string | string[] } }) {
  return <BiometricGate next={safeNext(searchParams.next)} />;
}
