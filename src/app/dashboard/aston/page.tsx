import { Suspense } from "react";
import { AstonStudio } from "@/components/aston/studio";

export const dynamic = "force-dynamic";
export const metadata = { title: "ASTON demos — JARVIS" };

/** ASTON's website & app demos: previews, versions, walkthrough, changes, approval. `?site=<id>` opens one; `&walk=1` starts the walkthrough. */
export default function AstonPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#0b1020" }} />}><AstonStudio /></Suspense>;
}
