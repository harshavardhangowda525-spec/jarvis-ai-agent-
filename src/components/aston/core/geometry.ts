/**
 * Where the ASTON Core sits on screen. Shared by the WebGL renderer and the
 * page layout, so the status line, the radial menu and the windows line up
 * with the core on every screen size.
 */
export interface CoreGeometry { cx: number; cy: number; u: number }

/** Core centre and its unit (the glass shell's radius), in CSS pixels. */
export function coreGeometry(w: number, h: number): CoreGeometry {
  const portrait = h > w;
  const short = h < 520;
  const cy = h * (short ? 0.36 : portrait ? 0.42 : 0.43);
  const u = short ? h * 0.24 : Math.min(h * (portrait ? 0.25 : 0.29), w * (portrait ? 0.45 : 0.42));
  return { cx: w / 2, cy, u: Math.max(60, u) };
}

/** Live signals that drive the core between React renders (no re-render per frame). */
export interface CoreSignal {
  /** Microphone loudness 0..1 while listening. */
  level: number;
  /** Set to 1 on each spoken word; the renderer lets it decay. */
  pulse: number;
  /** True once the speech engine reports word timings for the current utterance. */
  wordSync: boolean;
  /** Task progress 0..1, or null when the task can't report it (indeterminate arcs). */
  progress: number | null;
  /** Set to 1 when a task completes; the renderer lets it decay. */
  flash: number;
}

export const newSignal = (): CoreSignal => ({ level: 0, pulse: 0, wordSync: false, progress: null, flash: 0 });
