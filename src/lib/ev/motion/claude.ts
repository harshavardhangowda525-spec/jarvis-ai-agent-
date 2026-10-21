import "server-only";
import { completeWithFallback } from "@/lib/ai/complete";
import { getLiveBrain } from "@/lib/ai/brain";
import { getAiConfigs } from "@/lib/ai/client";
import type { AiConfig } from "@/lib/env";
import { EV_BUSINESS } from "@/lib/ev/config";
import { extractJson } from "@/lib/aston/build";
import { compileMotion, MotionCodeError } from "./sandbox";
import { probeFrames, type MotionCode } from "./render";

/**
 * EV's motion graphics, made by Claude on your PC (the Claude bridge — your
 * Claude plan, no Magic Hour, no API key). EV writes the creative prompt;
 * Claude answers with drawing code (`frame(t)` → SVG); JARVIS checks the code
 * runs and renders it. If the code fails, Claude gets the exact error once to
 * fix it.
 */

export type Aspect = "square" | "portrait" | "landscape";
/** Canvas Claude draws on (vector — rendered sharper on export). */
export const CANVAS: Record<Aspect, { w: number; h: number }> = {
  portrait: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
  landscape: { w: 1920, h: 1080 },
};

export class ClaudeMotionUnavailable extends Error {}

export interface MotionDesign { title: string; seconds: number; still: number; code: string }
export interface MotionResult { design: MotionDesign; motion: MotionCode; repaired: boolean }

export function motionSystemPrompt() {
  return `You are a senior motion designer who animates with code. You design premium, modern marketing visuals for ${EV_BUSINESS.name} (${EV_BUSINESS.tagline}; Instagram ${EV_BUSINESS.instagram}).

You write ONE JavaScript function:
  function frame(t) { ... return '<svg ...>...</svg>'; }
It returns the COMPLETE SVG for time t in seconds (0 ≤ t ≤ DURATION). Constants W, H (canvas size in px) and DURATION (seconds) are already defined.

Rules:
- Pure and deterministic: the same t gives the same SVG. No Math.random (write a tiny seeded PRNG if you need noise), no Date, no DOM, no fetch, no require/import, no eval.
- The root element: <svg xmlns="http://www.w3.org/2000/svg" width="\${W}" height="\${H}" viewBox="0 0 \${W} \${H}">.
- Animate by computing positions/opacity/scale from t with easing functions you write (easeOutCubic, easeInOutQuad, spring…). SMIL (<animate>) and CSS animations are NOT played — every frame is drawn from t.
- Allowed: shapes, paths, gradients (linear/radial), clipPath, mask, opacity, transforms, <text>, and filters like feGaussianBlur/feDropShadow (use sparingly). No <image>, <foreignObject>, external URLs or web fonts.
- Text: font-family="Inter", font-weight 800 for headlines and 500 for body. Keep all text inside a safe area (8% margin), large and readable on a phone. Escape &, < and > in text.
- Design: a strong hook in the first second, layered depth, smooth motion with easing, a clear focal point, a consistent 2–3 colour palette with good contrast, and a calm, readable final state. Kinetic typography and abstract/iconographic illustration built from shapes are great; don't try photorealism.
- Use only facts in the brief. Never invent prices, statistics, reviews or client names.
- Keep every shape at least partly on the canvas (skip shapes that are fully off-screen); no zero-size or enormous shapes; never let NaN/Infinity reach the SVG.
- Keep frame() fast (well under 50 ms) and the code under 600 lines.

Reply with ONE JSON object only:
{"title": "<short name>", "seconds": <duration you designed for>, "still": <the best single moment in seconds, for a still image>, "code": "<the JavaScript, as a JSON string>"}`;
}

type Ask = (system: string, user: string) => Promise<string>;

/** Claude on your PC, or a clear reason it can't be used. */
export async function claudeAsk(userId: string): Promise<Ask> {
  const brain = await getLiveBrain(userId).catch(() => null);
  const cfg = (() => { try { return getAiConfigs("claude", brain).find((c) => c.provider === "claude"); } catch { return undefined; } })();
  if (!cfg) throw new ClaudeMotionUnavailable("EV makes images and videos with Claude on your PC, and it isn't connected right now. Start JARVIS with start-jarvis.cmd (CLAUDE_FOR_ALL_AGENTS=1 in .env.local) — or, for the online app, run the Claude bridge on your PC — then ask again.");
  return (system, user) => completeWithFallback([cfg as AiConfig], system, user, { maxTokens: 16_000, timeoutMs: 240_000 });
}

function parseDesign(reply: string, seconds: number): MotionDesign {
  let j: Record<string, unknown>;
  try { j = extractJson(reply) as Record<string, unknown>; } catch {
    // Claude sometimes answers with just the code in a ```js block
    const code = /```(?:js|javascript)?\s*([\s\S]*?function\s+frame[\s\S]*?)```/i.exec(reply)?.[1];
    if (!code) throw new MotionCodeError("Claude didn't return the animation code.");
    j = { code };
  }
  const code = String(j.code ?? "");
  if (!/function\s+frame\s*\(|(?:const|let|var)\s+frame\s*=/.test(code)) throw new MotionCodeError("Claude's answer has no frame(t) function.");
  const s = Math.min(20, Math.max(3, Number(j.seconds) || seconds));
  const still = Math.min(s, Math.max(0, Number(j.still) || s * 0.7));
  return { title: String(j.title ?? "EV motion graphic").slice(0, 80), seconds: s, still, code };
}

/** Check the code: run it on a spread of times, then really draw a few frames (small) in the render helper. */
async function trial(d: MotionDesign, aspect: Aspect, probe: (m: MotionCode, times: number[]) => Promise<void>): Promise<MotionCode> {
  const { w, h } = CANVAS[aspect];
  const program = compileMotion(d.code, { width: w, height: h, seconds: d.seconds });
  try { for (let i = 0; i <= 12; i++) program.frame((d.seconds * i) / 12); program.frame(d.still); } finally { program.dispose(); }
  const m = { code: d.code, width: w, height: h, seconds: d.seconds };
  await probe(m, [0, d.seconds / 3, (2 * d.seconds) / 3, d.seconds, d.still]);
  return m;
}

export async function designMotion(ask: Ask, o: { brief: string; aspect: Aspect; seconds: number; video: boolean; probe?: (m: MotionCode, times: number[]) => Promise<void> }): Promise<MotionResult> {
  const probe = o.probe ?? probeFrames;
  const { w, h } = CANVAS[o.aspect];
  const system = motionSystemPrompt();
  const user = `Canvas: ${w}×${h} (${o.aspect}). Duration: ${o.seconds} seconds. ${o.video ? "This will be exported as a video, so make the motion the star." : "This will be exported as a still image at your best moment, so the final composition must look great on its own (motion is a bonus)."}

Creative brief from EV:
${o.brief.trim()}`;
  const first = await ask(system, user);
  let design: MotionDesign;
  try {
    design = parseDesign(first, o.seconds);
    return { design, motion: await trial(design, o.aspect, probe), repaired: false };
  } catch (e) {
    if (!(e instanceof MotionCodeError)) throw e;
    // one repair round with the exact error
    const again = await ask(system, `${user}\n\nYour previous answer couldn't be rendered: ${e.message}\nFix it and reply with the complete corrected JSON object only.\n\nPrevious code:\n${first.slice(0, 40_000)}`);
    design = parseDesign(again, o.seconds);
    return { design, motion: await trial(design, o.aspect, probe), repaired: true };
  }
}
