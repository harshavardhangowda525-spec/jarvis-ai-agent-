"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

/**
 * Browser side of the gate. Face unlock goes through WebAuthn with the
 * device's platform authenticator — the OS shows its own biometric prompt
 * (Windows Hello, Face ID, Touch ID, Android) and matches the face on the
 * device. This file never touches camera frames or biometric data.
 */

export interface GateStatus {
  signedIn: boolean; unlocked: boolean; deviceHint: boolean;
  email?: string; method?: string | null; fresh?: boolean; enrolled?: number; pinSet?: boolean; lockedMs?: number; attemptsLeft?: number;
  /** JARVIS Face ID (in-app) enrolment for this server. */
  faceId?: { enrolled: boolean; enrolledAt: string | null; elsewhere: boolean; outdated?: boolean };
  /** Signed out: this device's face sign-in user has JARVIS Face ID. */
  faceSignIn?: boolean;
}

export type FaceResult =
  | { ok: true; signedIn?: boolean }
  | { ok: false; kind: "aborted" | "cancelled" | "rejected" | "locked" | "not-enrolled" | "expired" | "error"; lockedMs?: number; attemptsLeft?: number; message?: string };

/** Does this device have a biometric (user-verifying) authenticator built in? */
export async function platformBiometricsAvailable(): Promise<boolean> {
  try {
    return typeof window !== "undefined" && !!window.PublicKeyCredential
      && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch { return false; }
}

async function api<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T & { error?: string; details?: Record<string, unknown> } }> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, credentials: "same-origin", cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && j.ok !== false, data: { ...(j.data ?? {}), error: j.error, details: j.details } };
}

export async function gateStatus(): Promise<GateStatus> {
  const r = await api<GateStatus>("/api/gate/status");
  return r.data;
}

const errName = (e: unknown): string => {
  const x = e as { name?: string; cause?: { name?: string }; code?: string };
  return x?.cause?.name || x?.name || "";
};

/** Ask the device to verify the face, then have the server check the signature. */
export async function faceUnlock(signedIn: boolean): Promise<FaceResult> {
  const opt = await api<{ challengeId: string; options: never }>("/api/gate/face/options", { method: "POST", body: JSON.stringify({ purpose: "unlock" }) });
  if (opt.status === 423) return { ok: false, kind: "locked", lockedMs: Number(opt.data.details?.lockedMs ?? 60_000) };
  if (opt.status === 404) return { ok: false, kind: "not-enrolled" };
  if (!opt.ok) return { ok: false, kind: "error", message: opt.data.error };

  const began = performance.now();
  let response;
  try {
    response = await startAuthentication({ optionsJSON: opt.data.options });
  } catch (e) {
    const name = errName(e);
    // refused before anything was shown (tab not focused, or the browser wants a tap) → not an attempt
    if (performance.now() - began < 450 && (name === "NotAllowedError" || name === "SecurityError")) return { ok: false, kind: "aborted" };
    if (name === "NotAllowedError" || name === "AbortError" || name === "TimeoutError") {
      // the device's check failed or was dismissed — it still counts
      if (signedIn) {
        const f = await api<{ lockedMs: number; attemptsLeft: number }>("/api/gate/failed", { method: "POST" });
        if (f.data.lockedMs > 0) return { ok: false, kind: "locked", lockedMs: f.data.lockedMs };
        return { ok: false, kind: "cancelled", attemptsLeft: f.data.attemptsLeft };
      }
      return { ok: false, kind: "cancelled" };
    }
    return { ok: false, kind: "error", message: (e as Error)?.message };
  }

  const v = await api<{ signedIn: boolean }>("/api/gate/face/verify", { method: "POST", body: JSON.stringify({ challengeId: opt.data.challengeId, response }) });
  if (v.ok) return { ok: true, signedIn: v.data.signedIn };
  if (v.status === 423) return { ok: false, kind: "locked", lockedMs: Number(v.data.details?.lockedMs ?? 60_000) };
  if (v.data.details?.expired) return { ok: false, kind: "expired" };
  return { ok: false, kind: "rejected", attemptsLeft: v.data.details?.attemptsLeft as number | undefined };
}

export type FallbackResult = { ok: true } | { ok: false; message: string; lockedMs?: number; attemptsLeft?: number };
async function fallback(url: string, body: object): Promise<FallbackResult> {
  const r = await api<object>(url, { method: "POST", body: JSON.stringify(body) });
  if (r.ok) return { ok: true };
  const d = r.data.details ?? {};
  return { ok: false, message: r.data.error ?? "Something went wrong.", lockedMs: Number(d.lockedMs ?? 0) || undefined, attemptsLeft: d.attemptsLeft as number | undefined };
}
export const pinUnlock = (pin: string) => fallback("/api/gate/pin", { pin });
export const passwordUnlock = (password: string) => fallback("/api/gate/password", { password });
export async function lockNow() { await api("/api/gate/lock", { method: "POST" }); }

/** Enrol this device's face unlock (the OS asks for the face; JARVIS stores only a public key). */
export async function enrollFace(label: string, replace: boolean): Promise<{ ok: true } | { ok: false; message: string; reverify?: boolean }> {
  const opt = await api<{ challengeId: string; options: never }>("/api/gate/face/options", { method: "POST", body: JSON.stringify({ purpose: "enroll" }) });
  if (!opt.ok) return { ok: false, message: opt.data.error ?? "Couldn't start enrolment.", reverify: !!opt.data.details?.reverify };
  let response;
  try {
    response = await startRegistration({ optionsJSON: opt.data.options });
  } catch (e) {
    const name = errName(e);
    if (name === "InvalidStateError") return { ok: false, message: "This device is already enrolled." };
    if (name === "NotAllowedError" || name === "AbortError") return { ok: false, message: "Enrolment was cancelled or the device couldn't confirm it was you." };
    return { ok: false, message: (e as Error)?.message || "Enrolment failed." };
  }
  const v = await api("/api/gate/face/enroll", { method: "POST", body: JSON.stringify({ challengeId: opt.data.challengeId, response, label, replace }) });
  return v.ok ? { ok: true } : { ok: false, message: v.data.error ?? "Enrolment failed.", reverify: !!v.data.details?.reverify };
}

/** A friendly name for this device's biometrics. */
export function biometricName(): string {
  if (typeof navigator === "undefined") return "device biometrics";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "Windows Hello";
  if (/iPhone|iPad/i.test(ua)) return "Face ID";
  if (/Macintosh/i.test(ua)) return "Touch ID";
  if (/Android/i.test(ua)) return "device biometrics";
  return "device biometrics";
}
