"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Check, Link2, Unplug } from "lucide-react";

interface Profile {
  displayName: string | null;
  assistantName: string;
  timezone: string;
  language: string;
  theme: string;
}
interface VoiceCfg {
  configured: boolean;
  preferences: { voiceId: string | null; voiceEnabled: boolean; autoListen: boolean; speakingRate: number };
  voices: { id: string; name: string }[];
}
interface Integration {
  id: string;
  label: string;
  available: boolean;
  status: string;
  kind?: "oauth" | "key";
}
interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
}

const OAUTH_ERRORS: Record<string, string> = {
  token_exchange_failed:
    "Google rejected the token exchange — your GOOGLE_CLIENT_SECRET is likely wrong. Re-copy it into Vercel and redeploy.",
  no_token: "Google didn't return an access token — check the OAuth client type and secret.",
  store_failed: "Couldn't save the connection (database error). Check DATABASE_URL.",
  bad_state: "Sign-in session expired. Try again in the same browser (not incognito), and ensure AUTH_SECRET is set.",
  missing_code: "Google didn't return an authorization code. Try connecting again.",
  token_unreachable: "Couldn't reach Google's token endpoint. Try again.",
  denied: "You cancelled the Google authorization.",
  unavailable: "Google isn't configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.",
};

export function SettingsClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [voice, setVoice] = useState<VoiceCfg | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [ai, setAi] = useState<{ providers: { id: string; label: string }[]; selected: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then((j) => j.data?.profile && setProfile(j.data.profile));
    fetch("/api/voice/config").then((r) => r.json()).then((j) => j.data && setVoice(j.data));
    fetch("/api/integrations").then((r) => r.json()).then((j) => j.data && setIntegrations(j.data.integrations));
    fetch("/api/sessions").then((r) => r.json()).then((j) => j.data && setSessions(j.data.sessions));
    fetch("/api/ai/config").then((r) => r.json()).then((j) => j.data && setAi(j.data));

    // Surface the OAuth callback result (connected=1 or error=<reason>).
    const p = new URLSearchParams(window.location.search);
    const provider = p.get("integration") ?? "Provider";
    const cap = provider.charAt(0).toUpperCase() + provider.slice(1);
    if (p.get("connected")) {
      setNotice({ ok: true, text: `${cap} connected successfully.` });
    } else if (p.get("error")) {
      const raw = p.get("error")!;
      const [code, ...rest] = raw.split(":");
      const detail = rest.join(":");
      const base = OAUTH_ERRORS[code] ?? `connection failed (${code}).`;
      setNotice({ ok: false, text: `${cap}: ${base}${detail ? ` [Google said: ${detail}]` : ""}` });
    }
    if (p.get("connected") || p.get("error")) {
      window.history.replaceState({}, "", "/dashboard/settings#integrations");
    }
  }, []);

  async function saveProfile() {
    if (!profile) return;
    await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: profile.displayName,
        assistantName: profile.assistantName,
        timezone: profile.timezone,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveVoice(patch: Partial<VoiceCfg["preferences"]>) {
    if (!voice) return;
    const next = { ...voice, preferences: { ...voice.preferences, ...patch } };
    setVoice(next);
    await fetch("/api/voice/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  }

  async function saveAiProvider(provider: string) {
    setAi((a) => (a ? { ...a, selected: provider || null } : a));
    await fetch("/api/ai/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: provider || "default" }),
    });
  }

  async function disconnect(id: string) {
    await fetch(`/api/integrations/${id}/disconnect`, { method: "POST" });
    setIntegrations((xs) => xs.map((x) => (x.id === id ? { ...x, status: "disconnected" } : x)));
  }

  async function revokeOthers() {
    await fetch("/api/sessions", { method: "DELETE" });
    setSessions((xs) => xs.filter((s) => s.current));
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-5" id="integrations">
      {/* General */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          General
        </h2>
        {profile ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input
                value={profile.displayName ?? ""}
                onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
              />
            </Field>
            <Field label="Assistant name">
              <Input
                value={profile.assistantName}
                onChange={(e) => setProfile({ ...profile, assistantName: e.target.value })}
              />
            </Field>
            <Field label="Timezone">
              <Input
                value={profile.timezone}
                onChange={(e) => setProfile({ ...profile, timezone: e.target.value })}
                placeholder="e.g. America/New_York"
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={saveProfile}>
                {saved ? <Check className="h-4 w-4" /> : null}
                {saved ? "Saved" : "Save changes"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </section>

      {/* AI Brain */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          AI Brain
        </h2>
        {ai == null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : ai.providers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No AI provider is configured. Add a provider key (e.g.{" "}
            <code className="text-accent">GROQ_API_KEY</code> or{" "}
            <code className="text-accent">GEMINI_API_KEY</code>) in your deployment.
          </p>
        ) : (
          <Field label="Primary model provider">
            <select
              value={ai.selected ?? ""}
              onChange={(e) => saveAiProvider(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background/60 px-3 text-sm"
            >
              <option value="">Default (automatic)</option>
              {ai.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-muted-foreground">
              JARVIS uses this provider first, then automatically falls back to the
              others if it’s rate-limited. Only providers with keys configured are shown.
            </p>
          </Field>
        )}
      </section>

      {/* Voice */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Voice
        </h2>
        {voice == null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !voice.configured ? (
          <p className="text-sm text-muted-foreground">
            JARVIS voice is not configured. Add <code className="text-accent">ELEVENLABS_API_KEY</code>{" "}
            and <code className="text-accent">ELEVENLABS_VOICE_ID</code> to enable speech.
          </p>
        ) : (
          <div className="space-y-4">
            <Toggle
              label="Voice enabled"
              checked={voice.preferences.voiceEnabled}
              onChange={(v) => saveVoice({ voiceEnabled: v })}
            />
            <Toggle
              label="Auto-listen (hands-free)"
              checked={voice.preferences.autoListen}
              onChange={(v) => saveVoice({ autoListen: v })}
            />
            {voice.voices.length > 0 && (
              <Field label="Voice">
                <select
                  value={voice.preferences.voiceId ?? ""}
                  onChange={(e) => saveVoice({ voiceId: e.target.value || null })}
                  className="h-10 w-full rounded-lg border border-input bg-background/60 px-3 text-sm"
                >
                  <option value="">Default (from configuration)</option>
                  {voice.voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}
      </section>

      {/* Integrations */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Integrations
        </h2>
        {notice && (
          <div
            className={cn(
              "mb-4 rounded-xl border px-3 py-2.5 text-xs",
              notice.ok
                ? "border-success/40 bg-success/10 text-success"
                : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {notice.text}
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {integrations.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
              <span className="text-sm font-medium">{it.label}</span>
              <div className="ml-auto">
                {it.kind === "key" ? (
                  it.available ? (
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <Link2 className="h-3 w-3" /> Connected
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Add API key</span>
                  )
                ) : !it.available ? (
                  <span className="text-[11px] text-muted-foreground">Not configured</span>
                ) : it.status === "connected" ? (
                  <button
                    onClick={() => disconnect(it.id)}
                    className="flex items-center gap-1 text-[11px] text-destructive hover:underline"
                  >
                    <Unplug className="h-3 w-3" /> Disconnect
                  </button>
                ) : (
                  <a
                    href={`/api/integrations/${it.id}/connect`}
                    className="flex items-center gap-1 text-[11px] text-accent hover:underline"
                  >
                    <Link2 className="h-3 w-3" /> Connect
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Integrations activate only after a successful OAuth authorization. Configure a
          provider's client credentials to make it connectable.
        </p>
      </section>

      {/* Security */}
      <section className="glass rounded-2xl p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Security
        </h2>
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <div className="truncate">{s.userAgent ?? "Unknown device"}</div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(s.createdAt).toLocaleString()}
                </div>
              </div>
              {s.current && (
                <span className="ml-auto rounded-full bg-success/20 px-2 py-0.5 text-[10px] text-success">
                  this device
                </span>
              )}
            </div>
          ))}
        </div>
        {sessions.length > 1 && (
          <Button variant="outline" className="mt-4" onClick={revokeOthers}>
            Sign out other sessions
          </Button>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="flex w-full items-center gap-3 text-left"
      type="button"
    >
      <span className="text-sm">{label}</span>
      <span
        className={cn(
          "ml-auto flex h-6 w-11 items-center rounded-full p-0.5 transition",
          checked ? "bg-accent" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "h-5 w-5 rounded-full bg-white transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </span>
    </button>
  );
}
