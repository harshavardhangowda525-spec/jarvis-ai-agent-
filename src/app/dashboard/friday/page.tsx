import { Suspense } from "react";
import { FridayApp } from "@/components/friday/friday-app";

export const dynamic = "force-dynamic";
export const metadata = { title: "FRIDAY — JARVIS" };

/** FRIDAY: chat by default; "activate agentic view" opens the 3D workspace. ?project=&v=&view=agentic&ask= */
export default function FridayPage() {
  return <Suspense fallback={<div style={{ height: "calc(100dvh - 4rem)", background: "#05080f" }} />}><FridayApp /></Suspense>;
}
