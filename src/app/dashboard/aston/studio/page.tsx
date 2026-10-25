import { Suspense } from "react";
import { BuildStudio } from "@/components/aston/build-studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "ASTON studio — JARVIS" };

/** ASTON's website studio: ?project=<id> shows the code being written next to the live preview. */
export default function AstonStudioPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#070b12" }} />}><BuildStudio /></Suspense>;
}
