import { describe, expect, it, vi } from "vitest";

describe("Face ID templates at rest", () => {
  it("round-trips, detects tampering, and is unreadable under another server secret", async () => {
    vi.resetModules();
    process.env.AUTH_SECRET = "first-secret-first-secret-first-secret";
    const a = await import("@/lib/gate/face-template");
    const desc = [Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1), Array.from({ length: 128 }, (_, i) => Math.cos(i) * 0.1)];
    const sealed = a.sealTemplate(desc);
    // nothing readable in the stored bytes
    expect(Buffer.from(sealed.data).includes(Buffer.from(new Float32Array(desc[0]).buffer).subarray(0, 16))).toBe(false);
    const back = a.openTemplate(sealed)!;
    expect(back).toHaveLength(2);
    expect(Math.max(...back[0].map((v, i) => Math.abs(v - desc[0][i])))).toBeLessThan(1e-6);
    const tampered = { ...sealed, data: Buffer.from(sealed.data) }; tampered.data[3] ^= 1;
    expect(a.openTemplate(tampered)).toBeNull();
    const idA = a.templateKeyId();

    vi.resetModules();
    process.env.AUTH_SECRET = "second-secret-second-secret-second";
    const b = await import("@/lib/gate/face-template");
    expect(b.templateKeyId()).not.toBe(idA);
    expect(b.openTemplate(sealed)).toBeNull();
  });
});
