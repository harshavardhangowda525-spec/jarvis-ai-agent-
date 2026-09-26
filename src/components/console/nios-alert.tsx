"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, ExternalLink, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * NIOS alerts inside JARVIS. While the console is open it asks the server to
 * check the official NIOS pages every few minutes; any notice that appeared
 * since watching started pops up here (and is spoken), and — when the tab is in
 * the background — also arrives as a desktop notification.
 */

export interface NiosNotice {
  id: string; source: string; sourceLabel: string; title: string; url: string;
  dateText: string | null; category: string; firstSeenAt: string;
}
interface CheckResponse {
  checked: boolean; baselineAdded: number; unseen: NiosNotice[];
  sources: { key: string; label: string; ok: boolean; count: number; error?: string }[];
}

const POLL_MS = 10 * 60_000;
const WELCOME_KEY = "nios.watch.welcomed";

const CAT: Record<string, { label: string; tone: string }> = {
  exam: { label: "EXAM", tone: "bg-cyan-300/15 text-cyan-100 border-cyan-200/30" },
  result: { label: "RESULT", tone: "bg-emerald-300/15 text-emerald-100 border-emerald-200/30" },
  fee: { label: "FEE", tone: "bg-amber-300/15 text-amber-100 border-amber-200/30" },
  admission: { label: "ADMISSION", tone: "bg-violet-300/15 text-violet-100 border-violet-200/30" },
  general: { label: "NOTICE", tone: "bg-white/10 text-white/80 border-white/20" },
};

function store(key: string, v?: string) {
  try { if (v === undefined) return localStorage.getItem(key); localStorage.setItem(key, v); } catch { /* private mode */ }
  return null;
}

export function useNiosWatch(opts: { speak: (text: string) => void }) {
  const [alerts, setAlerts] = useState<NiosNotice[]>([]);
  const [welcome, setWelcome] = useState<{ pages: number; onFile: number } | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const speakRef = useRef(opts.speak); speakRef.current = opts.speak;
  const lastRun = useRef(0);
  const running = useRef(false);

  useEffect(() => { if (typeof Notification !== "undefined") setPermission(Notification.permission); }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true; lastRun.current = Date.now();
    try {
      const res = await fetch("/api/nios/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) return;
      const j = (await res.json())?.data as CheckResponse | undefined;
      if (!j) return;
      if (j.baselineAdded > 0 && !store(WELCOME_KEY)) {
        store(WELCOME_KEY, "1");
        setWelcome({ pages: j.sources.filter((s) => s.ok).length, onFile: j.baselineAdded });
      }
      const fresh = j.unseen ?? [];
      if (!fresh.length) return;
      setAlerts((cur) => { const have = new Set(cur.map((a) => a.id)); return [...fresh.filter((f) => !have.has(f.id)).reverse(), ...cur].slice(0, 20); });
      // spoken + desktop
      const first = fresh[fresh.length - 1];
      speakRef.current(fresh.length === 1 ? `New NIOS notification: ${first.title.slice(0, 160)}` : `${fresh.length} new NIOS notifications. The latest: ${first.title.slice(0, 140)}`);
      if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
        for (const n of fresh.slice(-3)) {
          try {
            const note = new Notification(`NIOS · ${(CAT[n.category] ?? CAT.general).label}`, { body: n.title, tag: `nios-${n.id}` });
            note.onclick = () => { window.focus(); window.open(n.url, "_blank", "noopener"); note.close(); };
          } catch { /* some browsers only allow notifications from a service worker */ }
        }
      }
      await fetch("/api/nios/seen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: fresh.map((f) => f.id) }) }).catch(() => {});
    } catch { /* offline — try again next round */ } finally { running.current = false; }
  }, []);

  useEffect(() => {
    const first = setTimeout(run, 4000);
    const id = setInterval(run, POLL_MS);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() - lastRun.current > 2 * 60_000) void run(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(first); clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [run]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try { setPermission(await Notification.requestPermission()); } catch { /* ignore */ }
  }, []);

  return {
    alerts, welcome, permission, requestPermission, checkNow: run,
    dismiss: (id: string) => setAlerts((a) => a.filter((x) => x.id !== id)),
    dismissAll: () => setAlerts([]),
    closeWelcome: () => setWelcome(null),
  };
}

export function NiosAlerts({ watch }: { watch: ReturnType<typeof useNiosWatch> }) {
  const { alerts, welcome } = watch;
  if (!alerts.length && !welcome) return null;
  const shown = alerts.slice(0, 3);
  const askDesktop = watch.permission === "default";
  return (
    <div className="pointer-events-none fixed right-3 top-20 z-[80] flex w-[min(380px,calc(100vw-24px))] flex-col gap-2" aria-live="polite" data-nios-alerts>
      {welcome && (
        <Card onClose={watch.closeWelcome}>
          <div className="flex items-center gap-2 text-[10px] tracking-[0.28em] text-cyan-100/80"><Bell className="h-3.5 w-3.5" /> NIOS WATCH ON</div>
          <p className="mt-1.5 text-[13px] leading-snug text-white/85">
            Watching {welcome.pages} official NIOS page{welcome.pages === 1 ? "" : "s"} · {welcome.onFile} current notices on file.
            I&apos;ll alert you the moment a new exam, result or any other notice appears.
          </p>
          {askDesktop && <DesktopButton onClick={watch.requestPermission} />}
        </Card>
      )}
      {shown.map((n) => {
        const c = CAT[n.category] ?? CAT.general;
        return (
          <Card key={n.id} onClose={() => watch.dismiss(n.id)} glow>
            <div className="flex items-center gap-2">
              <BellRing className="h-3.5 w-3.5 text-cyan-100" />
              <span className="text-[10px] tracking-[0.28em] text-white/60">NIOS</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-[9px] tracking-[0.2em]", c.tone)}>{c.label}</span>
              <span className="ml-auto truncate text-[10px] text-white/40">{n.sourceLabel}</span>
            </div>
            <p className="mt-1.5 line-clamp-3 text-[13px] leading-snug text-white">{n.title}</p>
            <div className="mt-2 flex items-center gap-2">
              {n.dateText && <span className="text-[11px] text-white/50">{n.dateText}</span>}
              <a href={n.url} target="_blank" rel="noopener noreferrer"
                className="pointer-events-auto ml-auto inline-flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-[11px] text-white/85 transition hover:bg-white/10">
                Open notice <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </Card>
        );
      })}
      {alerts.length > 3 && (
        <button onClick={watch.dismissAll} className="pointer-events-auto self-end rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] text-white/70 backdrop-blur hover:text-white">
          +{alerts.length - 3} more · dismiss all
        </button>
      )}
      {!welcome && alerts.length > 0 && askDesktop && <div className="pointer-events-auto self-end"><DesktopButton onClick={watch.requestPermission} /></div>}
    </div>
  );
}

function Card({ children, onClose, glow }: { children: React.ReactNode; onClose: () => void; glow?: boolean }) {
  return (
    <div className="pointer-events-auto relative overflow-hidden rounded-2xl border border-white/15 p-3.5 pr-9"
      style={{
        background: "linear-gradient(145deg, rgba(255,255,255,0.10), rgba(20,40,70,0.35))",
        backdropFilter: "blur(20px) saturate(140%)", WebkitBackdropFilter: "blur(20px) saturate(140%)",
        boxShadow: glow ? "0 18px 50px -20px rgba(80,180,255,0.55), inset 0 1px 0 rgba(255,255,255,0.2)" : "0 18px 50px -24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.15)",
        animation: "dw-pop-in .5s cubic-bezier(.2,.9,.25,1.15) both",
      }}>
      <button onClick={onClose} aria-label="Dismiss" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white">
        <X className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

function DesktopButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="pointer-events-auto mt-2 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-1 text-[11px] text-cyan-50 hover:bg-cyan-200/20">
      Also alert me on the desktop
    </button>
  );
}
