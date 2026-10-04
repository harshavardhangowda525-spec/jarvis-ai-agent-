"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Lock, ScanFace, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { biometricName, enrollFace, gateStatus, lockNow, platformBiometricsAvailable, type GateStatus } from "@/lib/gate/client";

interface Cred { id: string; label: string; createdAt: string; lastUsedAt: string | null }

/**
 * Settings → Security → Face unlock. Enrol, re-enrol or remove this device's
 * face unlock and set the PIN fallback. Changes need a recent unlock (within
 * 10 minutes) — otherwise JARVIS asks you to verify again first. Nothing
 * biometric is shown here because JARVIS never has any: the device keeps it.
 */
export function GateSettings() {
  const router = useRouter();
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [creds, setCreds] = useState<Cred[]>([]);
  const [platform, setPlatform] = useState<boolean | null>(null);
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState(""); const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const bio = typeof navigator === "undefined" ? "device biometrics" : biometricName();

  const load = useCallback(async () => {
    const [s, c, p] = await Promise.all([
      gateStatus().catch(() => null),
      fetch("/api/gate/credentials", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      platformBiometricsAvailable(),
    ]);
    setStatus(s); setPlatform(p);
    setCreds(c?.data?.credentials ?? []);
  }, []);
  useEffect(() => { void load(); setLabel(`This device (${biometricName()})`); }, [load]);

  const fresh = !!status?.fresh;
  const reverify = async () => { await lockNow(); router.push("/unlock?next=/dashboard/settings"); };
  const run = async (key: string, fn: () => Promise<{ ok: boolean; text: string; reverify?: boolean }>) => {
    setBusy(key); setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.text });
      if (r.reverify) setStatus((s) => (s ? { ...s, fresh: false } : s));
      await load();
    } finally { setBusy(null); }
  };

  const enroll = (replace: boolean) => run(replace ? "reenroll" : "enroll", async () => {
    const r = await enrollFace(label, replace);
    return r.ok ? { ok: true, text: `Face unlock is set up with ${bio}. Next time, JARVIS opens when ${bio} recognizes you.` } : { ok: false, text: r.message, reverify: r.reverify };
  });
  const remove = (id: string | null) => run(`rm-${id ?? "all"}`, async () => {
    const res = await fetch(`/api/gate/credentials?${id ? `id=${encodeURIComponent(id)}` : "all=1"}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, text: id ? "Removed." : "Face unlock removed from every device." } : { ok: false, text: j.error ?? "Couldn't remove it.", reverify: !!j.details?.reverify };
  });
  const savePin = () => run("pin", async () => {
    if (pin !== pin2) return { ok: false, text: "The two PINs don't match." };
    const res = await fetch("/api/gate/pin", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
    const j = await res.json().catch(() => ({}));
    if (res.ok) { setPin(""); setPin2(""); }
    return res.ok ? { ok: true, text: "PIN saved." } : { ok: false, text: j.error ?? "Couldn't save the PIN.", reverify: !!j.details?.reverify };
  });
  const removePin = () => run("rmpin", async () => {
    const res = await fetch("/api/gate/pin", { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, text: "PIN removed — your password is the fallback." } : { ok: false, text: j.error ?? "Couldn't remove the PIN.", reverify: !!j.details?.reverify };
  });

  return (
    <section className="glass rounded-2xl p-5" data-gate-settings>
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        <ScanFace className="h-4 w-4" /> Face unlock
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">
        JARVIS opens only after {bio} recognizes you. Your face is matched by the device itself — JARVIS stores just a
        cryptographic key the device unlocks after a match, never your face or camera images. A PIN or your password
        always works as a fallback. Unlocks last until you close the browser (at most 12 hours).
      </p>

      {status && !fresh && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs text-amber-100/80">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">To change face unlock or the PIN, verify it&apos;s you again (unlocks older than 10 minutes can&apos;t change security settings).</span>
          <Button size="sm" variant="outline" onClick={reverify}>Verify now</Button>
        </div>
      )}

      {/* enrolled devices */}
      <div className="space-y-2">
        {creds.length === 0 && <div className="rounded-xl bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">No face enrolled yet.</div>}
        {creds.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
            <Fingerprint className="h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0">
              <div className="truncate">{c.label}</div>
              <div className="text-[10px] text-muted-foreground">
                Enrolled {new Date(c.createdAt).toLocaleDateString()} · {c.lastUsedAt ? `last used ${new Date(c.lastUsedAt).toLocaleString()}` : "not used yet"}
              </div>
            </div>
            <button type="button" disabled={!fresh || !!busy} onClick={() => remove(c.id)} className="ml-auto text-muted-foreground transition hover:text-destructive disabled:opacity-40" aria-label={`Remove ${c.label}`} title="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {platform === false ? (
        <p className="mt-4 text-xs text-muted-foreground">
          This device has no biometric sensor the browser can use (on Windows, set up Windows Hello Face in Settings → Accounts → Sign-in options, then reload).
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">Device name</span>
            <Input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} disabled={!fresh} />
          </label>
          <Button onClick={() => enroll(false)} disabled={!fresh || !!busy || platform === null}>{busy === "enroll" ? "Waiting for " + bio + "…" : creds.length ? "Enroll this device" : "Enroll face"}</Button>
          {creds.length > 0 && <Button variant="outline" onClick={() => enroll(true)} disabled={!fresh || !!busy}>{busy === "reenroll" ? "Waiting…" : "Re-enroll (replace all)"}</Button>}
        </div>
      )}
      {creds.length > 1 && <Button variant="outline" className="mt-2" onClick={() => remove(null)} disabled={!fresh || !!busy}>Remove from all devices</Button>}

      {/* PIN */}
      <div className="mt-6 border-t border-border/10 pt-4">
        <div className="mb-2 text-xs font-medium text-muted-foreground">PIN fallback {status?.pinSet ? "· set" : "· not set (your password is the fallback)"}</div>
        <div className="flex flex-wrap items-end gap-2">
          <Input type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN (6–12 digits)" value={pin} maxLength={12} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} disabled={!fresh} className="w-44" />
          <Input type="password" inputMode="numeric" autoComplete="new-password" placeholder="Repeat PIN" value={pin2} maxLength={12} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} disabled={!fresh} className="w-36" />
          <Button onClick={savePin} disabled={!fresh || !!busy || pin.length < 6}>{status?.pinSet ? "Change PIN" : "Set PIN"}</Button>
          {status?.pinSet && <Button variant="outline" onClick={removePin} disabled={!fresh || !!busy}>Remove PIN</Button>}
        </div>
      </div>

      {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-success" : "text-destructive"}`} role="status">{msg.text}</p>}

      <Button variant="outline" className="mt-5" onClick={async () => { await lockNow(); router.push("/unlock?next=/dashboard/settings"); }}>
        <Lock className="mr-2 h-4 w-4" /> Lock JARVIS now
      </Button>
    </section>
  );
}
