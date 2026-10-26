"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall, Smartphone, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Link {
  enabled: boolean; toNumber: string | null; jarvisNumber: string | null; paired: boolean;
  onCompleted: boolean; onFailed: boolean; onApproval: boolean;
  quietFrom: string | null; quietTo: string | null;
  lastSeenAt: string | null; device: string | null; online: boolean; lastCallAt: string | null;
}
interface Ev { id: string; kind: string; text: string; status: string; error: string | null; at: string }
interface Status { link: Link | null; events: Ev[]; lanUrls: string[] }

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? `${Math.max(1, Math.round(s))}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : new Date(iso).toLocaleDateString();
};

/**
 * Settings → Phone calls. A spare Android phone on Wi-Fi becomes JARVIS's
 * phone: it sends you what happened on WhatsApp and WhatsApp-calls you. No SIM
 * plan, no calling provider, no API key — just a pairing token between JARVIS
 * and that phone.
 */
export function PhoneSettings() {
  const [st, setSt] = useState<Status | null>(null);
  const [to, setTo] = useState(""); const [jn, setJn] = useState("");
  const [qf, setQf] = useState(""); const [qt, setQt] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loaded = useRef(false);

  const apply = useCallback((d: Status) => {
    setSt(d);
    setTo(d.link?.toNumber ?? ""); setJn(d.link?.jarvisNumber ?? "");
    setQf(d.link?.quietFrom ?? ""); setQt(d.link?.quietTo ?? "");
  }, []);
  const load = useCallback(async () => {
    const j = await fetch("/api/phone", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    if (!j?.ok) return;
    // the first load fills the form; later refreshes only update the live status
    if (loaded.current) setSt(j.data); else { loaded.current = true; apply(j.data); }
  }, [apply]);
  useEffect(() => { void load(); const t = setInterval(load, 15_000); return () => clearInterval(t); }, [load]);

  const call = async (method: "PATCH" | "POST", body: object, label: string, done?: string) => {
    setBusy(label); setMsg(null);
    const j = await fetch("/api/phone", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ ok: false, error: "JARVIS didn't answer." }));
    setBusy(null);
    if (!j.ok) { setMsg({ ok: false, text: j.error ?? "That didn't work." }); return null; }
    apply(j.data);
    if (done) setMsg({ ok: true, text: done });
    return j.data;
  };
  const save = () => call("PATCH", { toNumber: to || null, jarvisNumber: jn || null, quietFrom: qf || null, quietTo: qt || null, ...(st?.link ? {} : { enabled: true }) }, "save", "Saved.");
  const flag = (k: keyof Link, v: boolean) => call("PATCH", { [k]: v }, k);
  const doPair = async () => { const d = await call("POST", { action: "pair" }, "pair"); if (d?.token) setToken(d.token); };

  const l = st?.link;
  const url = st?.lanUrls[0] ?? "http://<PC-IP>:3000";
  const setup = token ? [
    "pkg update -y && pkg install -y curl jq android-tools",
    `curl -fsSL ${url}/api/phone/script -o jarvis-phone.sh`,
    `bash jarvis-phone.sh ${url} ${token}`,
  ].join("\n") : "";

  return (
    <section className="glass rounded-2xl p-5" id="phone">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground"><PhoneCall className="h-4 w-4" /> Phone calls</h2>
      <p className="mb-4 text-[12px] leading-relaxed text-muted-foreground">
        JARVIS uses a <b className="text-foreground">spare Android phone on Wi-Fi with WhatsApp</b> as its phone, and its WhatsApp number is JARVIS&apos;s number. When something happens, the spare phone sends you the details on WhatsApp, then <b className="text-foreground">WhatsApp-calls you</b>. You don&apos;t need a SIM plan, a calling service or an API key.
      </p>

      {/* the real link state */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
        <Smartphone className="h-4 w-4 text-muted-foreground" />
        {!l?.paired ? <span className="text-muted-foreground">No phone paired yet.</span>
          : l.online ? <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-success" />Phone connected{l.device ? ` (${l.device.replace(/\+/g, " ")})` : ""}. Last check-in {ago(l.lastSeenAt)}.</span>
          : <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning" />Paired, but the phone isn&apos;t checking in (last seen {ago(l.lastSeenAt)}). Open Termux on it and run <code className="text-accent">bash jarvis-phone.sh</code>.</span>}
        {l?.paired && <button className="ml-auto text-[11px] text-muted-foreground hover:text-destructive" onClick={() => call("POST", { action: "unpair" }, "unpair", "Unpaired. That phone can't reach JARVIS any more.")}>Unpair</button>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">Your WhatsApp number (JARVIS calls this)</span>
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="+919876543210" inputMode="tel" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">JARVIS&apos;s WhatsApp number (on the spare phone)</span>
          <Input value={jn} onChange={(e) => setJn(e.target.value)} placeholder="+91…" inputMode="tel" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">Quiet hours from (optional)</span>
          <Input value={qf} onChange={(e) => setQf(e.target.value)} placeholder="23:00" /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-medium text-muted-foreground">until</span>
          <Input value={qt} onChange={(e) => setQt(e.target.value)} placeholder="07:30" /></label>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">During quiet hours, calls wait until the quiet hours end. Times are in your timezone from Profile.</p>
      <Button className="mt-3" onClick={save} disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Button>

      {l && (
        <div className="mt-5 space-y-2.5">
          {([["enabled", "Phone calls on"], ["onCompleted", "Call me when a task is completed"], ["onFailed", "Call me when a task fails"], ["onApproval", "Call me when something needs my approval"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => flag(k, !l[k])} className="flex w-full items-center gap-3 text-left">
              <span className="text-sm">{label}</span>
              <span className={cn("ml-auto flex h-6 w-11 items-center rounded-full p-0.5 transition", l[k] ? "bg-accent" : "bg-muted")}>
                <span className={cn("h-5 w-5 rounded-full bg-white transition-transform", l[k] ? "translate-x-5" : "translate-x-0")} />
              </span>
            </button>
          ))}
          <p className="text-[11px] text-muted-foreground">Several updates close together become one call. JARVIS rings at most once every 2 minutes, and only about things that happen after calls are switched on.</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="outline" onClick={doPair} disabled={busy === "pair"}>{l?.paired ? "Pair again (new token)" : "Pair the spare phone"}</Button>
        <Button variant="outline" onClick={() => call("POST", { action: "test" }, "test", "Test call queued. The phone picks it up at its next check-in, within about 15 seconds.")} disabled={busy === "test" || !l?.paired || !l?.toNumber}>Test call</Button>
      </div>

      {token && (
        <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3 text-[12px] leading-relaxed">
          <div className="mb-2 font-medium text-foreground">Set up the spare phone (this token is shown only once)</div>
          <ol className="mb-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Connect the spare phone to the same Wi-Fi as this PC. It needs Android 11 or newer.</li>
            <li>Install <b className="text-foreground">WhatsApp</b> on it and sign in. WhatsApp sends a code once, by SMS or a voice call, and an unrecharged SIM can usually still receive it. Then save <b className="text-foreground">your</b> number in its Contacts and, in WhatsApp, tap New chat → ⋮ → Refresh.</li>
            <li>Set its screen lock to <b className="text-foreground">None</b> (Settings → Security) and keep it plugged in. A locked phone can&apos;t start a call by itself.</li>
            <li>Install <b className="text-foreground">Termux</b> from F-Droid.</li>
            <li>Turn on Developer options (Settings → About phone → tap Build number 7 times). Then go to Developer options → turn on <b className="text-foreground">Wireless debugging</b> → <b className="text-foreground">Pair device with pairing code</b>. With that screen open in split screen, run this in Termux, using the port and code it shows: <code className="text-accent">pkg install -y android-tools &amp;&amp; adb pair 127.0.0.1:PORT CODE</code>. This lets the script start WhatsApp calls. It needs no root and stays on the phone.</li>
            <li>Then paste this in Termux:</li>
          </ol>
          <pre className="overflow-x-auto whitespace-pre rounded-lg bg-black/40 p-2.5 text-[11px] text-accent">{setup}</pre>
          <button type="button" onClick={() => navigator.clipboard?.writeText(setup).catch(() => {})} className="mt-1.5 flex items-center gap-1 text-[11px] text-accent hover:underline"><Copy className="h-3 w-3" /> Copy</button>
          <ol start={7} className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Turn off battery optimisation for Termux, and keep it running. Leave Wireless debugging on. If it switches off after a Wi-Fi drop or a restart, turn it back on and the script reconnects by itself.</li>
            <li>On your own phone, save JARVIS&apos;s WhatsApp number as &ldquo;JARVIS&rdquo;.</li>
          </ol>
          {st && st.lanUrls.length > 1 && <p className="mt-2 text-muted-foreground">This PC has more than one network address. If the phone can&apos;t connect, try {st.lanUrls.slice(1).map((u) => <code key={u} className="mr-1 text-accent">{u}</code>)} instead.</p>}
          <p className="mt-2 text-muted-foreground">If the phone says it can&apos;t reach JARVIS, Windows Firewall is probably blocking it. When Windows asks, allow Node.js on <b className="text-foreground">Private networks</b>. Or run this once in an administrator Command Prompt: <code className="break-all text-accent">netsh advfirewall firewall add rule name=&quot;JARVIS phone&quot; dir=in action=allow protocol=TCP localport=3000 profile=private</code></p>
          {!st?.lanUrls.length && <p className="mt-2 text-warning">Couldn&apos;t find this PC&apos;s Wi-Fi address. Run <code>ipconfig</code> and use the IPv4 address in place of &lt;PC-IP&gt;.</p>}
        </div>
      )}

      {msg && <p className={cn("mt-3 text-[12px]", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}

      {!!st?.events.length && (
        <div className="mt-5">
          <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Recent calls</div>
          <ul className="space-y-1">
            {st.events.map((e) => (
              <li key={e.id} className="flex items-start gap-2 rounded-lg bg-muted/30 px-2.5 py-1.5 text-[11.5px]">
                <span className={cn("mt-0.5 shrink-0 rounded px-1.5 text-[10px] uppercase tracking-wide", e.status === "sent" ? "bg-success/15 text-success" : e.status === "failed" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground")}>{e.status === "sending" ? "ringing" : e.status}</span>
                <span className="min-w-0 flex-1">{e.text}{e.error && <span className="block text-[10.5px] text-muted-foreground">{e.error}</span>}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{ago(e.at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
