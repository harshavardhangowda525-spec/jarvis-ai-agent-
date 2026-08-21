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
}
interface SessionRow {
  id: string;
  current: boolean;
  userAgent: string | null;
  createdAt: string;
}

export function SettingsClient() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [voice, setVoice] = useState<VoiceCfg | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/profile").then((r) => r.json()).then((j) => j.data?.profile && setProfile(j.data.profile));
    fetch("/api/voice/config").then((r) => r.json()).then((j) => j.data && setVoice(j.data));
    fetch("/api/integrations").then((r) => r.json()).then((j) => j.data && setIntegrations(j.data.integrations));
    fetch("/api/sessions").then((r) => r.json()).then((j) => j.data && setSessions(j.data.sessions));
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
        <div className="grid gap-2 sm:grid-cols-2">
          {integrations.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-3 py-2.5">
              <span className="text-sm font-medium">{it.label}</span>
              <div className="ml-auto">
                {!it.available ? (
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
