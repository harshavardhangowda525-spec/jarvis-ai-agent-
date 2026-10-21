/**
 * The motion-code sandbox (plain JS, shared by JARVIS and the render helper
 * process). Claude's `frame(t)` runs in its own V8 context with no access to
 * Node, files, the network or the host: the context's global has no prototype,
 * eval / new Function are off inside it, only a number goes in and only a
 * string comes out, and every call has a time limit.
 */
import vm from "node:vm";

export class MotionCodeError extends Error {}

const CALL_MS = 1500;
const MAX_SVG = 2_000_000;

export function compileMotion(code, o) {
  if (code.length > 200_000) throw new MotionCodeError("The animation code is too long.");
  if (/\brequire\s*\(|\bimport\s*[({]|\bimport\s+\w|\bFunction\s*\(|\beval\s*\(/.test(code)) {
    // not the security boundary (the context is) — just a clear early error
    throw new MotionCodeError("The animation code must be plain drawing code (no require, import or eval).");
  }
  const sandbox = Object.create(null);
  const ctx = vm.createContext(sandbox, { name: "ev-motion", codeGeneration: { strings: false, wasm: false } });
  try {
    new vm.Script(`"use strict";
const W = ${Number(o.width)}, H = ${Number(o.height)}, DURATION = ${Number(o.seconds)};
${code}
;if (typeof frame !== "function") throw new Error("the code must define function frame(t)");
globalThis.__frame = frame;`, { filename: "motion.js" }).runInContext(ctx, { timeout: 3000 });
  } catch (e) {
    throw new MotionCodeError(`The animation code doesn't run: ${String(e?.message ?? e).slice(0, 300)}`);
  }
  const call = new vm.Script(`globalThis.__out = String(globalThis.__frame(globalThis.__t));`, { filename: "frame.js" });
  return {
    frame(t) {
      sandbox.__t = Number(t);
      try { call.runInContext(ctx, { timeout: CALL_MS }); } catch (e) {
        throw new MotionCodeError(`frame(${t.toFixed(2)}) failed: ${String(e?.message ?? e).slice(0, 300)}`);
      }
      const svg = sandbox.__out;
      if (typeof svg !== "string" || !/^\s*<svg[\s>]/i.test(svg) || !/<\/svg>\s*$/i.test(svg)) throw new MotionCodeError(`frame(${t.toFixed(2)}) didn't return an <svg>…</svg> string.`);
      if (svg.length > MAX_SVG) throw new MotionCodeError(`frame(${t.toFixed(2)}) returned an SVG that's too large.`);
      if (/(?:href|src)\s*=\s*["'](?:https?:|file:|\/\/)/i.test(svg)) throw new MotionCodeError("The frames must not load outside images or files.");
      // (careful: "Infinity" is also in the business name — only numeric uses count)
      if (/\bNaN\b|-?\bInfinity(?=["',)]|px\b)/.test(svg)) throw new MotionCodeError(`frame(${t.toFixed(2)}) contains NaN/Infinity values (a division by zero or an undefined variable in the maths).`);
      return svg;
    },
    dispose() { delete sandbox.__frame; },
  };
}
