import { describe, it, expect, vi } from "vitest";
import { GrabThrowController, GRAB_DEFAULTS, handPose, springStep, type GrabInput, type GrabTarget, type HandPose } from "@/lib/gesture/grab-throw";

const BIN = { x: 900, y: 600, w: 50, h: 56 };                 // bottom-right bin
const EL: GrabTarget = { id: "g1", rect: { x: 180, y: 180, w: 200, h: 120 }, label: "Ad banner" };

function rig(pickResult: GrabTarget | null = EL, cfg = {}) {
  const hooks = {
    pick: vi.fn(async () => pickResult),
    onThrow: vi.fn(), onCancel: vi.fn(), onMiss: vi.fn(),
  };
  const c = new GrabThrowController(hooks, cfg);
  c.setBin(BIN);
  let t = 1000;
  const feed = (pose: HandPose, x: number, y: number, ms = 33, source: GrabInput["source"] = "hand") => { t += ms; c.input({ t, pose, x, y, source }); };
  /** move in steps from a→b holding a pose */
  const move = (pose: HandPose, a: [number, number], b: [number, number], steps = 12) => {
    for (let i = 1; i <= steps; i++) feed(pose, a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps);
  };
  const hold = (pose: HandPose, x: number, y: number, ms: number) => { for (let e = 0; e < ms; e += 33) feed(pose, x, y); };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { c, hooks, feed, move, hold, flush, now: () => t };
}

/** open hand → fist over the element → carried into the bin (fist still closed) */
async function grabAndCarry(r: ReturnType<typeof rig>, to: [number, number] = [925, 628]) {
  r.hold("open", 250, 230, 200);
  r.hold("fist", 250, 230, 250);
  await r.flush();
  expect(r.c.state.phase).toBe("carrying");
  r.move("fist", [250, 230], to, 15);
  r.hold("fist", to[0], to[1], 150);
}

describe("GrabAndThrow — the one sequence that throws", () => {
  it("open → fist → carry to the bin → open over it = throw (and nothing before that)", async () => {
    const r = rig();
    await grabAndCarry(r);
    expect(r.c.state.bin).toBe("ready");
    expect(r.hooks.onThrow).not.toHaveBeenCalled(); // carrying into the bin is not enough
    r.hold("open", 925, 628, 200);
    expect(r.hooks.onThrow).toHaveBeenCalledWith(EL);
    expect(r.c.state.phase).toBe("throwing");
    expect(r.c.state.bin).toBe("receiving");
    r.c.done();
    expect(r.c.state.phase).toBe("hover");
    expect(r.hooks.onCancel).not.toHaveBeenCalled();
  });

  it("grabs where the fist closed, and reports progress while it closes", async () => {
    const r = rig();
    r.hold("open", 250, 230, 200);
    r.feed("fist", 250, 230); r.feed("fist", 251, 231);
    expect(r.c.state.phase).toBe("closing");
    expect(r.c.state.closing).toBeGreaterThan(0);
    r.hold("fist", 251, 231, 200);
    await r.flush();
    expect(r.hooks.pick).toHaveBeenCalledWith(250, 230);
  });

  it("the bin reacts: idle → approaching → ready", async () => {
    const r = rig();
    r.hold("open", 250, 230, 200); r.hold("fist", 250, 230, 250); await r.flush();
    expect(r.c.state.bin).toBe("idle");
    r.move("fist", [250, 230], [760, 560]);
    expect(r.c.state.bin).toBe("approaching");
    r.move("fist", [760, 560], [920, 620]);
    expect(r.c.state.bin).toBe("ready");
  });
});

describe("GrabAndThrow — never deletes by accident", () => {
  it("a fist alone never removes anything (no carry, no release)", async () => {
    const r = rig();
    r.hold("open", 250, 230, 200); r.hold("fist", 250, 230, 3000); await r.flush();
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
  });

  it("a fist that was never open first doesn't grab", async () => {
    const r = rig();
    r.hold("fist", 250, 230, 800); await r.flush();
    expect(r.hooks.pick).not.toHaveBeenCalled();
  });

  it("a moving fist doesn't grab (a grab is deliberate and still)", async () => {
    const r = rig();
    r.hold("open", 100, 100, 200);
    r.move("fist", [100, 100], [700, 500], 10);
    await r.flush();
    expect(r.hooks.pick).not.toHaveBeenCalled();
  });

  it("opening the hand anywhere but the bin cancels and puts it back", async () => {
    const r = rig();
    r.hold("open", 250, 230, 200); r.hold("fist", 250, 230, 250); await r.flush();
    r.move("fist", [250, 230], [600, 400]);
    r.hold("open", 600, 400, 200);
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "released");
    expect(r.c.state.phase).toBe("returning");
    r.c.done();
    expect(r.c.state.target).toBeNull();
  });

  it("a flicker of 'open' from the tracker while carrying doesn't release", async () => {
    const r = rig();
    await grabAndCarry(r, [600, 400]);
    r.feed("open", 600, 400); r.feed("open", 600, 400); // ~66 ms < openHoldMs
    r.hold("fist", 600, 400, 200);
    expect(r.hooks.onCancel).not.toHaveBeenCalled();
    expect(r.c.state.phase).toBe("carrying");
  });

  it("a flicker of 'open' while passing through the bin doesn't throw", async () => {
    const r = rig();
    await grabAndCarry(r);
    r.feed("open", 925, 628); r.feed("open", 925, 628);
    r.hold("fist", 925, 628, 100);
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
  });

  it("just brushing the bin edge and opening at once doesn't throw (must stay in the zone a moment)", async () => {
    const r = rig();
    r.hold("open", 250, 230, 200); r.hold("fist", 250, 230, 250); await r.flush();
    r.move("fist", [250, 230], [700, 500], 10);
    r.feed("open", 925, 628, 16); r.hold("open", 925, 628, 200); // jumped in and opened in the same instant
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
    expect(r.hooks.onCancel).toHaveBeenCalled();
  });

  it("losing the hand for a moment is fine; losing it for long cancels", async () => {
    const r = rig();
    await grabAndCarry(r, [600, 400]);
    r.hold("none", 0, 0, 200);             // brief dropout
    r.hold("fist", 600, 400, 100);
    expect(r.c.state.phase).toBe("carrying");
    r.hold("none", 0, 0, 700);             // gone
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "lost");
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
  });

  it("the camera stopping entirely (no frames) cancels via tick()", async () => {
    const r = rig();
    await grabAndCarry(r, [600, 400]);
    r.c.tick(r.now() + 2000);
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "lost");
  });

  it("grabbing next to the bin and letting go inside it doesn't count (it wasn't carried there)", async () => {
    const r = rig({ ...EL, rect: { x: 860, y: 560, w: 60, h: 40 } });
    r.hold("open", 880, 590, 200); r.hold("fist", 880, 590, 250); await r.flush();
    r.move("fist", [880, 590], [920, 625], 4); r.hold("fist", 920, 625, 150);
    r.hold("open", 920, 625, 200);
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
  });

  it("a fist over nothing grabbable is a miss, not a grab", async () => {
    const r = rig(null);
    r.hold("open", 250, 230, 200); r.hold("fist", 250, 230, 250); await r.flush();
    expect(r.hooks.onMiss).toHaveBeenCalled();
    expect(r.c.state.phase).toBe("hover");
    r.hold("open", 925, 628, 300);
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
  });

  it("letting go before the element was even picked up puts it straight back", async () => {
    let resolve!: (t: GrabTarget) => void;
    const hooks = { pick: vi.fn(() => new Promise<GrabTarget>((r) => { resolve = r; })), onThrow: vi.fn(), onCancel: vi.fn() };
    const c = new GrabThrowController(hooks); c.setBin(BIN);
    let t = 0; const f = (pose: HandPose) => { t += 33; c.input({ t, pose, x: 250, y: 230, source: "hand" }); };
    for (let i = 0; i < 7; i++) f("open");
    for (let i = 0; i < 8; i++) f("fist");
    expect(c.state.phase).toBe("picking");
    for (let i = 0; i < 6; i++) f("open");
    resolve(EL); await new Promise((r) => setTimeout(r, 0));
    expect(hooks.onCancel).toHaveBeenCalledWith(EL, "released");
    expect(hooks.onThrow).not.toHaveBeenCalled();
  });

  it("carrying forever times out", async () => {
    const r = rig(EL, { maxCarryMs: 1000 });
    await grabAndCarry(r, [600, 400]);
    r.hold("fist", 600, 400, 1200);
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "timeout");
  });

  it("an outside cancel (page navigated) puts it back", async () => {
    const r = rig();
    await grabAndCarry(r, [600, 400]);
    r.c.cancel();
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "external");
  });

  it("thresholds are configurable (hitbox, carry distance)", async () => {
    const r = rig(EL, { hitboxPadPx: 0 });
    await grabAndCarry(r, [890, 598]);   // just outside the bin, inside the default padding
    r.hold("open", 890, 598, 200);
    expect(r.hooks.onThrow).not.toHaveBeenCalled();
    expect(new GrabThrowController({ pick: async () => null, onThrow() {}, onCancel() {} }, { releaseDistancePx: 10 }).config().releaseDistancePx).toBe(10);
    expect(GRAB_DEFAULTS.hitboxPadPx).toBeGreaterThan(0);
  });
});

describe("mouse / touch fallback", () => {
  it("press over an element, drag to the bin, release = throw; release elsewhere = back", async () => {
    const r = rig();
    const p = (pose: HandPose, x: number, y: number) => r.feed(pose, x, y, 16, "pointer");
    p("fist", 250, 230); await r.flush();
    expect(r.c.state.phase).toBe("carrying");
    for (let i = 1; i <= 10; i++) p("fist", 250 + 67 * i, 230 + 40 * i);
    p("open", 920, 630);
    expect(r.hooks.onThrow).toHaveBeenCalledWith(EL);
    r.c.done();

    r.feed("open", 250, 230, 400, "pointer"); // after the short cooldown
    p("fist", 250, 230); await r.flush();
    for (let i = 1; i <= 5; i++) p("fist", 250 + 40 * i, 230);
    p("open", 450, 230);
    expect(r.hooks.onCancel).toHaveBeenCalledWith(EL, "released");
  });

  it("hand frames without a hand don't interrupt a mouse drag", async () => {
    const r = rig();
    r.feed("fist", 250, 230, 16, "pointer"); await r.flush();
    r.feed("none", 0, 0, 16, "hand");
    expect(r.c.state.phase).toBe("carrying");
  });
});

describe("helpers", () => {
  it("reads the pose from an engine frame with confidence thresholds", () => {
    const frame = (pose: string, confidence: number) => ({ hand: true, reading: { pose, confidence } } as never);
    expect(handPose(frame("fist", 0.9))).toBe("fist");
    expect(handPose(frame("fist", 0.3))).toBe("other");
    expect(handPose(frame("open_palm", 0.8))).toBe("open");
    expect(handPose(frame("point", 0.9))).toBe("other");
    expect(handPose(null)).toBe("none");
  });
  it("the spring settles on its target", () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 120; i++) s = springStep(s, 100, 1 / 60);
    expect(Math.abs(s.x - 100)).toBeLessThan(0.5);
  });
});
