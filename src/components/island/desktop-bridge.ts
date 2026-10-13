"use client";

/**
 * What the RUBEN desktop app (desktop/rubin, Electron) exposes to the island
 * page through its preload script. Absent when the page is opened in an
 * ordinary browser tab — the island then says so instead of pretending to float.
 */
export type DesktopCommand = "toggle" | "open" | "close" | "listen" | "wake-on" | "wake-off" | "refresh";

export interface DesktopSettings { wake: boolean; voiceReplies: boolean; micId: string | null; launchAtLogin: boolean; shortcut: string; talkShortcut: string }

export interface RubinDesktop {
  /** Collapse the window to the outline (false) or make room for the pop-up (true). */
  setOpen(open: boolean): void;
  /** Let clicks reach the island (true) or pass through to the apps underneath (false). */
  setInteractive(on: boolean): void;
  dragStart(): void;
  dragEnd(): void;
  /** Sign in / unlock in a separate, normal-sized window. */
  openAuth(path: "/login" | "/unlock"): void;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: Partial<DesktopSettings>): Promise<DesktopSettings>;
  onCommand(cb: (c: DesktopCommand) => void): () => void;
  /** Hand over the words you said/typed; the desktop app decides if they're about an app on this PC (and asks you itself before anything risky). */
  pc?(text: string): Promise<{ handled: boolean; ok?: boolean; say?: string }>;
  version: string;
}

export function desktop(): RubinDesktop | null {
  return typeof window !== "undefined" ? ((window as unknown as { rubinDesktop?: RubinDesktop }).rubinDesktop ?? null) : null;
}
