"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Fingerprint, Lock, ScanFace, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { biometricName, enrollFace, gateStatus, lockNow, platformBiometricsAvailable, type GateStatus } from "@/lib/gate/client";
import { FaceEnrollment } from "./face-enrollment";

interface Cred { id: string; label: string; createdAt: string; lastUsedAt: string | null }

/**
 * Settings → Face unlock. JARVIS Face ID (enrolled right here with the camera),
 * the PIN fallback, and — under Advanced — the device's own biometrics
 * (Windows Hello…). Changes need a recent unlock (within 10 minutes) —
 * otherwise JARVIS asks you to verify again first. Nothing biometric is ever
 * shown here: the enrolment stays encrypted on the server.
 */
export function GateSettings() {
  const router = useRouter();
  const search = useSearchParams();
  const [enrolling, setEnrolling] = useState(false);
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
  // arrived from the gate with no face enrolled yet → start enrolling right away
  useEffect(() => { if (search.get("enroll") === "face") { setEnrolling(true); router.replace("/dashboard/settings"); } }, [search, router]);
  const removeFaceId = () => run("rm-faceid", async () => {
    const res = await fetch("/api/gate/face-id", { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, text: "Face ID removed." } : { ok: false, text: j.error ?? "Couldn't remove Face ID.", reverify: !!j.details?.reverify };
  });
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
    return r.ok ? { ok: true, text: `${bio} is set up. You can also unlock JARVIS with it.` } : { ok: false, text: r.message, reverify: r.reverify };
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
        JARVIS opens only after it recognizes your face. Enroll right here with your camera — no system settings needed.
        Your face is turned into numbers on this device and stored encrypted on your JARVIS server; no photo or video is
        ever saved or uploaded. A PIN or your password always works as a fallback. Unlocks last until you close the
        browser (at most 12 hours).
      </p>

      {status && !fresh && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300/20 bg-amber-300/5 px-3 py-2.5 text-xs text-amber-100/80">
          <Lock className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">To change Face ID or the PIN, verify it&apos;s you again (unlocks older than 10 minutes can&apos;t change security settings).</span>
          <Button size="sm" variant="outline" onClick={reverify}>Verify now</Button>
        </div>
      )}

      {/* JARVIS Face ID */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-muted/40 px-3 py-3 text-sm" data-faceid-status={status?.faceId?.enrolled ? "enrolled" : "none"}>
        <ScanFace className="h-5 w-5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div>JARVIS Face ID</div>
          <div className="text-[11px] text-muted-foreground">
            {status?.faceId?.enrolled
              ? `Enrolled ${new Date(status.faceId.enrolledAt!).toLocaleString()}`
              : status?.faceId?.elsewhere ? "Enrolled on another JARVIS server — enroll here too" : "Not enrolled yet"}
          </div>
        </div>
        <Button onClick={() => setEnrolling(true)} disabled={!fresh || !!busy}>{status?.faceId?.enrolled ? "Re-enroll face" : "Enroll face"}</Button>
        {status?.faceId?.enrolled && <Button variant="outline" onClick={removeFaceId} disabled={!fresh || !!busy}>Remove</Button>}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Camera face recognition is convenient but not as strong as a dedicated biometric sensor: JARVIS asks you to blink or
        turn your head each time to stop photos, and locks after repeated failures.
      </p>

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


      {/* Advanced: the device's own biometrics */}
      <details className="mt-6 border-t border-border/10 pt-4">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Advanced: also unlock with {bio} (the device&apos;s own biometrics)</summary>
        <div className="mt-3">
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
          <Button onClick={() => enroll(false)} disabled={!fresh || !!busy || platform === null}>{busy === "enroll" ? "Waiting for " + bio + "…" : creds.length ? "Add this device" : `Set up ${bio}`}</Button>
          {creds.length > 0 && <Button variant="outline" onClick={() => enroll(true)} disabled={!fresh || !!busy}>{busy === "reenroll" ? "Waiting…" : "Re-enroll (replace all)"}</Button>}
        </div>
      )}
      {creds.length > 1 && <Button variant="outline" className="mt-2" onClick={() => remove(null)} disabled={!fresh || !!busy}>Remove from all devices</Button>}

        </div>
      </details>

      {msg && <p className={`mt-3 text-xs ${msg.ok ? "text-success" : "text-destructive"}`} role="status">{msg.text}</p>}

      <Button variant="outline" className="mt-5" onClick={async () => { await lockNow(); router.push("/unlock?next=/dashboard/settings"); }}>
        <Lock className="mr-2 h-4 w-4" /> Lock JARVIS now
      </Button>
      {enrolling && (
        <FaceEnrollment
          onClose={(ok) => { setEnrolling(false); if (ok) setMsg({ ok: true, text: "Face ID is set up. Next time, JARVIS unlocks when it sees you." }); void load(); }}
          onReverify={async () => { await lockNow(); router.push("/unlock?next=%2Fdashboard%2Fsettings%3Fenroll%3Dface"); }}
        />
      )}
    </section>
  );
}
