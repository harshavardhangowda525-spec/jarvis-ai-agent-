"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Lock, Maximize2, Minimize2, RotateCw, X } from "lucide-react";
import { chooseMode, officialEmbed } from "@/lib/web-embed";
import { resolveSite } from "@/lib/open-site";
import { ultronKnown, ultronPair } from "@/lib/local-ultron";

/**
 * JARVIS's glass browser: a link opens right here instead of a new tab.
 *
 *  - official players (YouTube videos, Maps, Spotify, Vimeo) and sites that
 *    allow framing → an <iframe>, fully interactive;
 *  - everything else (YouTube's home page, Gmail, Amazon, GitHub… refuse to be
 *    framed) → ULTRON's live browser on your PC, streamed in with your clicks,
 *    scrolls and typing sent back;
 *  - when neither is possible → a preview card with an "Open in new tab" button.
 */

export interface BrowserTarget { url: string; label: string; key: number }

interface Preview { url: string; title: string | null; description: string | null; image: string | null; siteName: string | null; icon: string | null; error?: string }

type View =
  | { mode: "checking" }
  | { mode: "embed" | "frame"; src: string }
  | { mode: "live" }
  | { mode: "preview"; preview: Preview | null; reason: string; canRetryLive: boolean };

type Dialog = { kind: string; message: string; value: string } | null;

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|0\.0\.0\.0)/;

/** What's typed in the address bar → a URL (an address, a known site, or a Google search). */
export function addressToUrl(text: string): string | null {
  let t = text.trim();
  if (!t) return null;
  // an address whose path has spaces ("example.com/a b") → keep them, encoded
  if (/\s/.test(t) && /^(?:https?:\/\/)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?[/?#]/i.test(t)) t = t.replace(/\s/g, "%20");
  const site = resolveSite(t);
  if (site) return site.url;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

function mods(e: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return { alt: e.altKey, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey };
}
const BUTTON = ["left", "middle", "right"] as const;

export function BrowserPopup({ target, onClose, onOpenTab }: { target: BrowserTarget; onClose: () => void; onOpenTab: (url: string) => void }) {
  const [view, setView] = useState<View>({ mode: "checking" });
  const [url, setUrl] = useState(target.url);
  const [address, setAddress] = useState(target.url);
  const [title, setTitle] = useState(target.label);
  const [loading, setLoading] = useState(true);
  const [nav, setNav] = useState({ back: false, forward: false });
  const [live, setLive] = useState<"connecting" | "live" | "lost" | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [cursor, setCursor] = useState("default");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [max, setMax] = useState(false);
  const [closing, setClosing] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  const seq = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const areaRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ width: 1100, height: 700 });
  const addrFocused = useRef(false);
  const history = useRef<string[]>([]); // for iframe pages (their own history is cross-origin)
  const frameSeq = useRef({ got: 0, drawn: 0 });

  const close = useCallback(() => { setClosing(true); setTimeout(onClose, 300); }, [onClose]);

  const areaSize = () => {
    const r = areaRef.current?.getBoundingClientRect();
    return { width: Math.round(r?.width || 1100), height: Math.round(r?.height || 700) };
  };

  const send = (m: unknown) => { const ws = wsRef.current; if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); };

  const stopLive = () => { const ws = wsRef.current; wsRef.current = null; if (ws) { ws.onclose = null; ws.close(); } setLive(null); };

  const startLive = useCallback((pair: { base: string; token: string }, to: string) => {
    stopLive();
    setView({ mode: "live" });
    setLive("connecting");
    setLiveError(null);
    setLoading(true);
    const ws = new WebSocket(`${pair.base.replace(/^http/, "ws")}/browser?token=${encodeURIComponent(pair.token)}`);
    ws.binaryType = "blob";
    wsRef.current = ws;
    ws.onopen = () => {
      sizeRef.current = areaSize();
      ws.send(JSON.stringify({ t: "open", url: to, ...sizeRef.current, dpr: window.devicePixelRatio || 1 }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        const n = ++frameSeq.current.got;
        void createImageBitmap(ev.data as Blob).then((bmp) => {
          const c = canvasRef.current;
          if (!c || n < frameSeq.current.drawn) { bmp.close(); return; }
          frameSeq.current.drawn = n;
          if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
          c.getContext("2d")?.drawImage(bmp, 0, 0);
          bmp.close();
          setLive((s) => (s === "connecting" ? "live" : s));
        }).catch(() => {});
        return;
      }
      let m: Record<string, unknown>;
      try { m = JSON.parse(ev.data); } catch { return; }
      switch (m.t) {
        case "state":
          setUrl(String(m.url));
          if (!addrFocused.current) setAddress(String(m.url));
          if (m.title) setTitle(String(m.title));
          setLoading(!!m.loading);
          setNav({ back: !!m.canGoBack, forward: !!m.canGoForward });
          break;
        case "cursor": setCursor(String(m.cursor || "default").replace(/^auto$/, "default")); break;
        case "dialog": setDialog({ kind: String(m.kind), message: String(m.message ?? ""), value: String(m.value ?? "") }); break;
        case "notice": setNotice(String(m.message)); break;
        case "error": setLiveError(String(m.message)); setLoading(false); break;
        case "closed": setLiveError("The page closed itself."); break;
      }
    };
    ws.onclose = () => { if (wsRef.current === ws) { setLive("lost"); setLoading(false); } };
  }, []);

  const load = useCallback(async (to: string, label?: string) => {
    const my = ++seq.current;
    stopLive();
    setUrl(to); setAddress(to); setTitle(label || hostOf(to)); setLoading(true); setDialog(null); setLiveError(null);
    setNav({ back: history.current.length > 0, forward: false });
    const emb = officialEmbed(to);
    if (emb) { setView({ mode: "embed", src: emb.url }); return; }
    setView({ mode: "checking" });
    let host = "";
    try { host = new URL(to).hostname; } catch { /* checked below */ }
    const mixed = location.protocol === "https:" && to.startsWith("http:");
    const [check, pair] = await Promise.all([
      PRIVATE_HOST.test(host) ? Promise.resolve(null)
        : fetch(`/api/browser/check?url=${encodeURIComponent(to)}&origin=${encodeURIComponent(location.origin)}`)
          .then((r) => r.json()).then((j) => (j?.ok ? (j.data as Preview & { frameable: boolean | null; reachable: boolean }) : null)).catch(() => null),
      ultronKnown() ? ultronPair() : Promise.resolve(null),
    ]);
    if (my !== seq.current) return;
    const canLive = !!(pair && pair.ok && pair.features.includes("browser"));
    const mode = chooseMode({ embed: false, frameable: check ? check.frameable : null, live: canLive, mixedContent: mixed });
    if (mode === "frame") { setView({ mode: "frame", src: to }); return; }
    if (mode === "live" && pair && pair.ok) { startLive(pair, to); return; }
    setLoading(false);
    if (check?.title) setTitle(check.title);
    const name = label || check?.siteName || hostOf(to);
    let reason: string;
    if (check?.error && !check.reachable && /doesn't exist|DNS/.test(check.error)) reason = `I couldn't reach ${hostOf(to)} — ${check.error}.`;
    else if (pair && pair.ok) reason = `${name} doesn't let other apps show it inside them, and the ULTRON on your PC is an older version without the live browser — pull the latest JARVIS and restart npm run local, then I can run it right here.`;
    else if (pair && !pair.ok && pair.reason === "origin") reason = `${name} doesn't let other apps show it inside them. ${pair.message}`;
    else reason = `${name} doesn't let other apps show it inside them. Start ULTRON on your PC (npm run local) and I'll run it live right here.`;
    setView({ mode: "preview", preview: check, reason, canRetryLive: !(pair && pair.ok) });
  }, [startLive]);

  // a new link from JARVIS → load it
  useEffect(() => {
    history.current = [];
    void load(target.url, target.label);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.key]);

  useEffect(() => () => stopLive(), []);

  const retryLive = async () => {
    setView({ mode: "checking" }); setLoading(true);
    const pair = await ultronPair();
    if (pair.ok && pair.features.includes("browser")) startLive(pair, url);
    else void load(url, title);
  };

  const go = (to: string) => {
    if (view.mode === "live" && live !== "lost" && wsRef.current) { send({ t: "nav", url: to }); setLoading(true); return; }
    history.current.push(url);
    void load(to);
  };

  const back = () => {
    if (view.mode === "live") { send({ t: "back" }); return; }
    const prev = history.current.pop();
    if (prev) void load(prev);
  };
  const forward = () => { if (view.mode === "live") send({ t: "forward" }); };
  const reload = () => {
    if (view.mode === "live") { if (live === "lost" || liveError) void load(url, title); else send({ t: "reload" }); return; }
    if (view.mode === "embed" || view.mode === "frame") { setLoading(true); setFrameKey((k) => k + 1); return; }
    void load(url, title);
  };

  // Escape closes (unless you're typing into the live page)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.activeElement === canvasRef.current || dialog) return;
      if (addrFocused.current) { (document.activeElement as HTMLElement | null)?.blur(); return; }
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, dialog]);

  // keep the live page the size of the window
  useEffect(() => {
    const el = areaRef.current;
    if (!el || view.mode !== "live") return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = areaSize();
        if (s.width !== sizeRef.current.width || s.height !== sizeRef.current.height) { sizeRef.current = s; send({ t: "resize", ...s }); }
      }, 180);
    });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [view.mode]);

  // wheel must be non-passive to stop the JARVIS page scrolling
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || view.mode !== "live") return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      const p = toPage(e);
      send({ t: "mouse", type: "wheel", ...p, dx: e.deltaX * k, dy: e.deltaY * k, ...mods(e) });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [view.mode]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 4500); return () => clearTimeout(t); }, [notice]);

  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * sizeRef.current.width, y: ((e.clientY - r.top) / r.height) * sizeRef.current.height };
  };
  const moveRaf = useRef<number | null>(null);
  const lastMove = useRef<{ x: number; y: number; buttons: number; m: ReturnType<typeof mods> } | null>(null);

  const secure = url.startsWith("https:");
  const modeChip = view.mode === "live" ? (live === "lost" ? "OFFLINE" : "LIVE · YOUR PC") : view.mode === "embed" ? "PLAYER" : view.mode === "frame" ? "WEB" : view.mode === "preview" ? "PREVIEW" : "…";

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center p-2 sm:p-5"
      style={{ animation: closing ? "dw-scrim-out .3s ease forwards" : "dw-scrim-in .35s ease" }}>
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[3px]" />

      <div data-testid="jarvis-browser"
        className={`jv-browser relative flex flex-col overflow-hidden rounded-[28px] border border-white/20 ${max ? "h-full w-full" : "h-[min(840px,88vh)] w-[min(1240px,96vw)]"}`}
        style={{
          background: "linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04) 40%, rgba(120,200,255,0.06))",
          backdropFilter: "blur(28px) saturate(160%)", WebkitBackdropFilter: "blur(28px) saturate(160%)",
          boxShadow: "0 40px 120px -28px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 0 100px -55px rgba(255,255,255,0.7)",
          animation: closing ? "ev-dissolve .3s ease forwards" : "dw-pop-in .55s cubic-bezier(.2,.9,.25,1.15) both",
        }}>
        {/* glass sheen */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-24" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.16), transparent)" }} />

        {/* toolbar */}
        <div className="relative z-10 flex items-center gap-1.5 px-3 pb-2 pt-3 sm:gap-2 sm:px-4">
          <ToolBtn label="Back" onClick={back} disabled={view.mode === "live" ? !nav.back : history.current.length === 0}><ArrowLeft className="h-4 w-4" /></ToolBtn>
          <ToolBtn label="Forward" onClick={forward} disabled={view.mode !== "live" || !nav.forward}><ArrowRight className="h-4 w-4" /></ToolBtn>
          <ToolBtn label="Reload" onClick={reload}><RotateCw className={`h-4 w-4 ${loading ? "animate-spin [animation-duration:1.2s]" : ""}`} /></ToolBtn>
          <form className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
            onSubmit={(e) => { e.preventDefault(); const to = addressToUrl(address); if (to) { (document.activeElement as HTMLElement | null)?.blur(); go(to); } }}>
            {secure ? <Lock className="h-3.5 w-3.5 shrink-0 text-emerald-200/80" /> : <Globe className="h-3.5 w-3.5 shrink-0 text-white/50" />}
            <input aria-label="Address" value={address} spellCheck={false}
              onChange={(e) => setAddress(e.target.value)}
              onFocus={(e) => { addrFocused.current = true; e.target.select(); }}
              onBlur={() => { addrFocused.current = false; }}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-white/90 outline-none placeholder:text-white/30" placeholder="Search or type an address" />
            <span className={`hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-[0.14em] sm:flex ${view.mode === "live" && live !== "lost" ? "bg-cyan-300/15 text-cyan-100" : "bg-white/10 text-white/60"}`}>
              {view.mode === "live" && live === "live" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />}
              {modeChip}
            </span>
          </form>
          <ToolBtn label="Open in a new tab" onClick={() => onOpenTab(url)}><ExternalLink className="h-4 w-4" /></ToolBtn>
          <ToolBtn label={max ? "Restore" : "Maximize"} onClick={() => setMax((v) => !v)} className="hidden sm:flex">{max ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</ToolBtn>
          <ToolBtn label="Close" onClick={close}><X className="h-4 w-4" /></ToolBtn>
        </div>

        {/* loading shimmer */}
        <div className="relative z-10 mx-4 h-[2px] overflow-hidden rounded-full">
          {loading && <div className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-cyan-200/80 to-transparent" style={{ animation: "jv-browser-load 1.1s ease-in-out infinite" }} />}
        </div>

        {/* page */}
        <div ref={areaRef} className="relative z-10 m-2 mt-1.5 flex-1 overflow-hidden rounded-[20px] border border-white/10 bg-[#0b0f17] sm:m-3 sm:mt-2">
          {(view.mode === "embed" || view.mode === "frame") && (
            <iframe key={`${view.src}#${frameKey}`} src={view.src} title={title} className="h-full w-full bg-white"
              onLoad={() => setLoading(false)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads"
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
          )}

          {view.mode === "live" && (
            <>
              <canvas ref={canvasRef} tabIndex={0} aria-label={`${title} — live`} data-testid="jarvis-browser-live"
                className="h-full w-full bg-white outline-none" style={{ cursor }}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={(e) => {
                  e.currentTarget.focus();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  send({ t: "mouse", type: "down", ...toPage(e), button: BUTTON[e.button] ?? "left", buttons: e.buttons, clicks: e.detail || 1, ...mods(e) });
                }}
                onPointerMove={(e) => {
                  lastMove.current = { ...toPage(e), buttons: e.buttons, m: mods(e) };
                  if (moveRaf.current == null) {
                    moveRaf.current = requestAnimationFrame(() => {
                      moveRaf.current = null;
                      const l = lastMove.current;
                      if (l) send({ t: "mouse", type: "move", x: l.x, y: l.y, buttons: l.buttons, ...l.m });
                    });
                  }
                }}
                onPointerUp={(e) => send({ t: "mouse", type: "up", ...toPage(e), button: BUTTON[e.button] ?? "left", buttons: e.buttons, clicks: e.detail || 1, ...mods(e) })}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return; // let the paste event carry the text
                  e.preventDefault(); e.stopPropagation();
                  send({ t: "key", type: "down", key: e.key, code: e.code, keyCode: e.keyCode, repeat: e.repeat, location: e.location, ...mods(e) });
                }}
                onKeyUp={(e) => { e.preventDefault(); e.stopPropagation(); send({ t: "key", type: "up", key: e.key, code: e.code, keyCode: e.keyCode, location: e.location, ...mods(e) }); }}
                onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData("text"); if (text) send({ t: "text", text }); }}
              />
              {live === "connecting" && !liveError && (
                <Center>
                  <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-200" />
                  <p className="text-sm text-white/80">Opening {hostOf(url)} in the live browser on your PC…</p>
                </Center>
              )}
              {(liveError || live === "lost") && (
                <Center>
                  <p className="max-w-md text-sm text-white/85">{liveError ?? "Lost the live browser — is ULTRON still running on your PC?"}</p>
                  <div className="flex gap-2">
                    <GlassBtn onClick={reload}>Try again</GlassBtn>
                    <GlassBtn onClick={() => onOpenTab(url)}>Open in a new tab</GlassBtn>
                  </div>
                </Center>
              )}
              {dialog && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <DialogBox dialog={dialog} onAnswer={(accept, value) => { send({ t: "dialog", accept, value }); setDialog(null); canvasRef.current?.focus(); }} />
                </div>
              )}
            </>
          )}

          {view.mode === "checking" && (
            <Center>
              <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-cyan-200" />
              <p className="text-sm text-white/75">Opening {title || hostOf(url)}…</p>
            </Center>
          )}

          {view.mode === "preview" && (
            <div className="flex h-full items-center justify-center overflow-y-auto p-6">
              <div className="w-full max-w-lg overflow-hidden rounded-[22px] border border-white/15 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
                {view.preview?.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={view.preview.image} alt="" className="h-48 w-full object-cover" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                )}
                <div className="space-y-3 p-5">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/50">
                    {view.preview?.icon && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={view.preview.icon} alt="" className="h-4 w-4 rounded" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    )}
                    {view.preview?.siteName || hostOf(url)}
                  </div>
                  <p className="text-lg font-light text-white">{view.preview?.title || title}</p>
                  {view.preview?.description && <p className="line-clamp-3 text-[13px] leading-relaxed text-white/65">{view.preview.description}</p>}
                  <p className="rounded-xl border border-cyan-100/10 bg-cyan-100/[0.05] px-3 py-2 text-[12px] leading-relaxed text-cyan-50/80">{view.reason}</p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <GlassBtn primary onClick={() => onOpenTab(url)}>Open in a new tab ↗</GlassBtn>
                    {view.canRetryLive && <GlassBtn onClick={() => { void retryLive(); }}>ULTRON is running — show it here</GlassBtn>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {notice && (
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <p className="rounded-full border border-white/15 bg-black/60 px-4 py-1.5 text-[12px] text-white/85 backdrop-blur">{notice}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolBtn({ label, onClick, disabled, children, className = "" }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] text-white/80 transition hover:bg-white/15 hover:text-white disabled:opacity-30 disabled:hover:bg-white/[0.06] ${className}`}>
      {children}
    </button>
  );
}

function GlassBtn({ onClick, children, primary }: { onClick: () => void; children: React.ReactNode; primary?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-[12px] transition ${primary ? "border-cyan-100/30 bg-cyan-100/15 text-cyan-50 hover:bg-cyan-100/25" : "border-white/20 bg-white/[0.06] text-white/85 hover:bg-white/15"}`}>
      {children}
    </button>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0f17]/85 p-6 text-center">{children}</div>;
}

function DialogBox({ dialog, onAnswer }: { dialog: NonNullable<Dialog>; onAnswer: (accept: boolean, value?: string) => void }) {
  const [value, setValue] = useState(dialog.value);
  return (
    <div className="w-[min(420px,90%)] space-y-3 rounded-[20px] border border-white/20 bg-[#141a26]/90 p-5 shadow-2xl backdrop-blur-xl">
      <p className="whitespace-pre-wrap text-sm text-white/90">{dialog.message || "This page asks:"}</p>
      {dialog.kind === "prompt" && (
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onAnswer(true, value); }}
          className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-sm text-white outline-none" />
      )}
      <div className="flex justify-end gap-2">
        {dialog.kind !== "alert" && <GlassBtn onClick={() => onAnswer(false)}>Cancel</GlassBtn>}
        <GlassBtn primary onClick={() => onAnswer(true, value)}>OK</GlassBtn>
      </div>
    </div>
  );
}
