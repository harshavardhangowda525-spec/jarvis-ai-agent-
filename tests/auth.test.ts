import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySession } from "@/lib/auth/jwt";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toBe("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("does not throw on malformed hashes", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe("session JWT", () => {
  it("signs and verifies a session token", async () => {
    const token = await signSession({ sub: "user1", email: "a@b.com", jti: "jti1" });
    const claims = await verifySession(token);
    expect(claims).not.toBeNull();
    expect(claims!.sub).toBe("user1");
    expect(claims!.email).toBe("a@b.com");
    expect(claims!.jti).toBe("jti1");
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ sub: "user1", email: "a@b.com", jti: "jti1" });
    const tampered = token.slice(0, -3) + "abc";
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("not.a.jwt")).toBeNull();
  });
});
