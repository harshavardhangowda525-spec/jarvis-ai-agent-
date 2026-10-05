import { describe, expect, it } from "vitest";
import { gateReducer, initialGate, type GateEvent, type GateState } from "@/lib/gate/machine";

const run = (evs: GateEvent[], s: GateState = initialGate(), now = 1_000_000) => evs.reduce((a, e) => gateReducer(a, e, now), s);
const ready: GateEvent[] = [{ type: "READY", canFace: true }, { type: "CAMERA", status: "on" }];

describe("biometric gate state machine", () => {
  it("the happy path", () => {
    const seen: string[] = [];
    let s = initialGate(); seen.push(s.phase);
    for (const e of [...ready, { type: "FACE", present: true }, { type: "SCAN" }, { type: "VERIFY" }, { type: "VERIFIED" }, { type: "DONE" }] as GateEvent[]) { s = gateReducer(s, e, 0); if (seen.at(-1) !== s.phase) seen.push(s.phase); }
    expect(seen).toEqual(["initializing", "camera-ready", "face-detected", "scanning", "verifying", "verified", "unlocked"]);
    expect(s.via).toBe("face");
  });

  it("seeing a face never unlocks — only the server's verdict does", () => {
    const faces: GateEvent[] = Array.from({ length: 50 }, (_, i) => ({ type: "FACE", present: i % 3 !== 0 }));
    const s = run([...ready, ...faces, { type: "SCAN" }, { type: "DONE" }, { type: "RETRY" }, { type: "LOCK_OVER" }, { type: "CAMERA", status: "on" }]);
    expect(["verified", "unlocked"]).not.toContain(s.phase);
    // VERIFIED outside of a running verification is ignored
    expect(run([...ready, { type: "VERIFIED" }]).phase).toBe("camera-ready");
    expect(run([...ready, { type: "FACE", present: true }, { type: "VERIFIED" }]).phase).toBe("face-detected");
  });

  it("not recognized → retry; too many → locked out until it's over", () => {
    let s = run([...ready, { type: "VERIFY" }, { type: "REJECTED", attemptsLeft: 3 }]);
    expect(s.phase).toBe("not-recognized");
    expect(s.attemptsLeft).toBe(3);
    s = run([{ type: "RETRY" }], s);
    expect(s.phase).toBe("camera-ready");
    s = run([{ type: "VERIFY" }, { type: "REJECTED", lockedMs: 60_000 }], s, 1_000_000);
    expect(s.phase).toBe("locked-out");
    // nothing starts while locked
    expect(gateReducer(s, { type: "VERIFY" }, 1_030_000).phase).toBe("locked-out");
    expect(gateReducer(s, { type: "LOCK_OVER" }, 1_030_000).phase).toBe("locked-out");
    expect(gateReducer(s, { type: "LOCK_OVER" }, 1_061_000).phase).toBe("camera-ready");
  });

  it("dismissing the device's prompt counts as a failed scan", () => {
    const s = run([...ready, { type: "VERIFY" }, { type: "CANCELLED" }]);
    expect(s.phase).toBe("not-recognized");
    expect(s.failures).toBe(1);
  });

  it("a liveness scan stopped part-way goes back to looking, without a failure", () => {
    const s = run([...ready, { type: "FACE", present: true }, { type: "SCAN" }, { type: "SCAN_ABORT" }]);
    expect(s.phase).toBe("camera-ready");
    expect(s.failures).toBe(0);
    expect(run([...ready, { type: "FACE", present: true }, { type: "SCAN" }, { type: "SCAN_ABORT", lockedMs: 60_000 }]).phase).toBe("locked-out");
  });

  it("a dialog the browser refused to show isn't a failure", () => {
    const s = run([...ready, { type: "VERIFY" }, { type: "ABORTED" }]);
    expect(s.phase).toBe("camera-ready");
    expect(s.failures).toBe(0);
  });

  it("camera states: permission, denied/error still allow face unlock through the device", () => {
    expect(run([{ type: "READY", canFace: true }, { type: "CAMERA", status: "prompt" }]).phase).toBe("camera-permission");
    const err = run([{ type: "READY", canFace: true }, { type: "CAMERA", status: "error" }]);
    expect(err.phase).toBe("camera-error");
    expect(gateReducer(err, { type: "VERIFY" }).phase).toBe("verifying");
    expect(run([{ type: "READY", canFace: true }, { type: "CAMERA", status: "prompt" }, { type: "CAMERA", status: "on" }]).phase).toBe("camera-ready");
  });

  it("no biometrics / nothing enrolled → PIN or password only", () => {
    const s = run([{ type: "READY", canFace: false, unavailable: "not-enrolled" }]);
    expect(s.phase).toBe("unavailable");
    expect(s.unavailable).toBe("not-enrolled");
    expect(gateReducer(s, { type: "VERIFY" }).phase).toBe("unavailable");
    expect(run([{ type: "FALLBACK_OK", via: "pin" }], s).phase).toBe("verified");
  });

  it("a lockout reported at start shows AUTHENTICATION FAILED", () => {
    expect(run([{ type: "READY", canFace: true, lockedMs: 30_000 }]).phase).toBe("locked-out");
  });

  it("a wrong PIN that triggers the lockout locks the gate", () => {
    const s = run([...ready, { type: "FALLBACK_REJECTED", lockedMs: 60_000 }]);
    expect(s.phase).toBe("locked-out");
    expect(run([{ type: "FALLBACK_REJECTED", attemptsLeft: 2 }], run(ready)).phase).toBe("camera-ready");
  });
});
