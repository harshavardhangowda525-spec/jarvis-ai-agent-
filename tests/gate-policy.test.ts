import { describe, expect, it } from "vitest";
import { afterFailure, afterSuccess, lockedFor, pinProblem, MAX_FAILURES } from "@/lib/gate/policy";

describe("gate lockout", () => {
  it("locks after 5 failures in a row, for 1 minute, then doubling up to 30", () => {
    const now = new Date("2026-10-04T10:00:00Z");
    let s = afterSuccess();
    for (let i = 1; i < MAX_FAILURES; i++) { s = afterFailure(s, now); expect(lockedFor(s, now)).toBe(0); }
    const l1 = afterFailure(s, now);
    expect(l1.justLocked).toBe(true);
    expect(lockedFor(l1, now)).toBe(60_000);
    let x: ReturnType<typeof afterFailure> = l1;
    const waits: number[] = [];
    for (let k = 0; k < 7; k++) { for (let i = 0; i < MAX_FAILURES; i++) x = afterFailure(x, now); waits.push(lockedFor(x, now) / 60_000); }
    expect(waits).toEqual([2, 4, 8, 16, 30, 30, 30]);
    expect(lockedFor(x, new Date(now.getTime() + 31 * 60_000))).toBe(0);
  });
  it("a success clears it", () => {
    const s = afterSuccess();
    expect(s).toEqual({ failedCount: 0, lockouts: 0, lockedUntil: null });
  });
  it("PINs: 6–12 digits, not trivial", () => {
    expect(pinProblem("12345")).toMatch(/6 to 12/);
    expect(pinProblem("abcdef")).toMatch(/6 to 12/);
    expect(pinProblem("111111")).toMatch(/same digit/);
    expect(pinProblem("123456")).toMatch(/sequence/);
    expect(pinProblem("987654")).toMatch(/sequence/);
    expect(pinProblem("482913")).toBeNull();
  });
});

describe("gate cookie", () => {
  it("is bound to the sign-in session and expires", async () => {
    process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-test-secret-test-secret";
    const { signGate, verifyGate, isFresh, apiOpenWhileLocked } = await import("@/lib/gate/token");
    const tok = await signGate({ sub: "u1", sid: "s1", method: "face" });
    expect((await verifyGate(tok, { sub: "u1", jti: "s1" }))?.method).toBe("face");
    expect(await verifyGate(tok, { sub: "u1", jti: "s2" })).toBeNull(); // another sign-in session
    expect(await verifyGate(tok, { sub: "u2", jti: "s1" })).toBeNull(); // another user
    expect(await verifyGate(tok + "x", { sub: "u1", jti: "s1" })).toBeNull(); // tampered
    expect(await verifyGate(tok, null)).toBeNull();
    const g = (await verifyGate(tok, { sub: "u1", jti: "s1" }))!;
    expect(isFresh(g, g.iat + 60)).toBe(true);
    expect(isFresh(g, g.iat + 11 * 60)).toBe(false);
    expect(g.exp - g.iat).toBe(12 * 3600);
    for (const p of ["/api/auth/login", "/api/gate/pin", "/api/health", "/api/cron/darwin"]) expect(apiOpenWhileLocked(p)).toBe(true);
    for (const p of ["/api/robin/leads", "/api/agent", "/api/gateway", "/api/memories"]) expect(apiOpenWhileLocked(p)).toBe(false);
  });
});
