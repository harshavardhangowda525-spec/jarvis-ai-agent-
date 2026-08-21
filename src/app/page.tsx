import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { Orb } from "@/components/orb";
import { capabilities } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  let user = null;
  try {
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (user) redirect("/dashboard");

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-10 animate-fade-in">
        <Orb state="idle" size={200} />
      </div>
      <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">
        JARVIS
        <span className="ml-2 align-middle text-sm font-normal text-accent">
          ● ONLINE
        </span>
      </h1>
      <p className="mt-4 max-w-xl text-balance text-muted-foreground">
        A general-purpose personal AI assistant. Speak naturally — JARVIS
        listens, reasons, uses tools, remembers, and replies in a natural voice.
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/signup"
          className="rounded-lg bg-accent px-6 py-3 font-medium text-accent-foreground shadow-[0_0_30px_-6px_hsl(var(--accent)/0.8)] transition hover:brightness-110"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-border px-6 py-3 font-medium transition hover:bg-muted/60"
        >
          Sign in
        </Link>
      </div>

      <div className="mt-14 grid max-w-3xl grid-cols-2 gap-4 text-left sm:grid-cols-4">
        {[
          ["Realtime voice", "Speak and be heard, hands-free"],
          ["Reasoning agent", "Chooses tools, chains steps"],
          ["Long-term memory", "Remembers what matters"],
          ["Tasks & notes", "Captured by voice or text"],
        ].map(([t, d]) => (
          <div key={t} className="glass rounded-xl p-4">
            <div className="text-sm font-medium">{t}</div>
            <div className="mt-1 text-xs text-muted-foreground">{d}</div>
          </div>
        ))}
      </div>

      <p className="mt-10 text-xs text-muted-foreground">
        Voice: {capabilities.voice ? "ElevenLabs configured" : "not configured"} ·{" "}
        AI: {capabilities.ai ? "configured" : "not configured"}
      </p>
    </main>
  );
}
