import { describe, expect, it } from "vitest";
import {
  distance, enrollmentProblem, ENROLL_STEPS, isDescriptor, livenessProblem, matchProbes, unlockSteps,
  type FaceProbe, type FaceStep,
} from "@/lib/gate/face-match";

// synthetic "people": a random base vector each; samples of one person are the base plus small noise
const rng = (seed: number) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) - 0.5; };
const person = (seed: number) => { const r = rng(seed); return Array.from({ length: 128 }, () => r() * 0.2); };
const sample = (base: number[], seed: number, noise = 0.022) => { const r = rng(seed); return base.map((v) => v + r() * noise * 2); };
const probe = (step: FaceStep, descriptor: number[], t: number, extra: Partial<FaceProbe> = {}): FaceProbe =>
  ({ step, descriptor, t, yaw: step === "left" ? -0.4 : step === "right" ? 0.4 : 0.02, blink: step === "blink" ? true : undefined, ...extra });

const me = person(1), other = person(2);

describe("JARVIS Face ID matching", () => {
  it("synthetic people sit where real ones do (same ≈ 0.3–0.45, different ≫ 0.6)", () => {
    expect(distance(sample(me, 1), sample(me, 2))).toBeLessThan(0.5);
    expect(distance(sample(me, 1), sample(other, 2))).toBeGreaterThan(0.6);
  });
  it("accepts the enrolled person, rejects someone else", () => {
    const enrolled = ENROLL_STEPS.map((_, i) => sample(me, 10 + i));
    expect(matchProbes(enrolled, [sample(me, 50), sample(me, 51), sample(me, 52)]).ok).toBe(true);
    expect(matchProbes(enrolled, [sample(other, 50), sample(other, 51), sample(other, 52)]).ok).toBe(false);
  });
  it("one bad probe is enough to reject (every probe must match)", () => {
    const enrolled = ENROLL_STEPS.map((_, i) => sample(me, 10 + i));
    const r = matchProbes(enrolled, [sample(me, 50), sample(other, 51), sample(me, 52)]);
    expect(r.ok).toBe(false);
    expect(r.max).toBeGreaterThan(0.55);
  });
  it("nothing enrolled / nothing probed never matches", () => {
    expect(matchProbes([], [sample(me, 1)]).ok).toBe(false);
    expect(matchProbes([sample(me, 1)], []).ok).toBe(false);
  });
  it("validates descriptors", () => {
    expect(isDescriptor(sample(me, 1))).toBe(true);
    expect(isDescriptor([1, 2, 3])).toBe(false);
    expect(isDescriptor([...sample(me, 1).slice(1), NaN])).toBe(false);
    expect(isDescriptor("x")).toBe(false);
  });
});

describe("liveness", () => {
  const ok = (steps: FaceStep[]) => steps.map((s, i) => probe(s, sample(me, 100 + i), 400 + i * 900));
  it("a real sequence passes", () => {
    for (const steps of [["center", "blink", "center"], ["center", "left", "center"], ["center", "right", "center"]] as FaceStep[][]) {
      expect(livenessProblem(steps, ok(steps))).toBeNull();
    }
  });
  it("the action must actually happen", () => {
    expect(livenessProblem(["center", "blink", "center"], ok(["center", "blink", "center"]).map((p) => ({ ...p, blink: false })))).toBe("no-blink");
    const noTurn = ok(["center", "left", "center"]); noTurn[1].yaw = 0.01;
    expect(livenessProblem(["center", "left", "center"], noTurn)).toBe("no-left-turn");
    const wrongWay = ok(["center", "right", "center"]); wrongWay[1].yaw = -0.4;
    expect(livenessProblem(["center", "right", "center"], wrongWay)).toBe("no-right-turn");
    const notStraight = ok(["center", "blink", "center"]); notStraight[0].yaw = 0.35;
    expect(livenessProblem(["center", "blink", "center"], notStraight)).toBe("not-straight");
  });
  it("a replayed (identical) descriptor, wrong steps or impossible timing fail", () => {
    const d = sample(me, 1);
    expect(livenessProblem(["center", "blink", "center"], [probe("center", d, 0), probe("blink", sample(me, 2), 900), probe("center", d, 1800)])).toBe("replayed");
    expect(livenessProblem(["center", "blink", "center"], ok(["center", "left", "center"]))).toBe("malformed");
    expect(livenessProblem(["center", "blink", "center"], ok(["center", "blink", "center"]).map((p, i) => ({ ...p, t: i * 100 })))).toBe("too-fast");
    expect(livenessProblem(["center", "blink", "center"], ok(["center", "blink"]))).toBe("incomplete");
  });
  it("unlock challenges always look straight, act, look straight", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) { const s = unlockSteps(); expect(s[0]).toBe("center"); expect(s[2]).toBe("center"); seen.add(s[1]); }
    expect([...seen].sort()).toEqual(["blink", "left", "right"]);
  });
});

describe("enrolment", () => {
  const good = () => ENROLL_STEPS.map((s, i) => probe(s, sample(me, 200 + i), i * 700));
  it("one person from every angle is fine", () => { expect(enrollmentProblem(good())).toBeNull(); });
  it("a second person sneaking into the samples is caught", () => {
    const g = good(); g[3] = probe("left", sample(other, 1), 2100); g[5] = probe("right", sample(other, 2), 3500);
    g[1] = probe("center", sample(other, 3), 700); g[6] = probe("right", sample(other, 4), 4200);
    expect(enrollmentProblem(g)).toMatch(/one person/);
  });
  it("too few samples or missing angles", () => {
    expect(enrollmentProblem(good().slice(0, 4))).toMatch(/Not enough/);
    expect(enrollmentProblem(good().map((p) => ({ ...p, step: "center" as FaceStep })))).toMatch(/Missing angles/);
  });
});
