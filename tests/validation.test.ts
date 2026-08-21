import { describe, it, expect } from "vitest";
import {
  signupSchema,
  loginSchema,
  agentRequestSchema,
  memoryInputSchema,
} from "@/lib/validation";

describe("validation schemas", () => {
  it("accepts a valid signup and normalizes email", () => {
    const parsed = signupSchema.parse({ email: "  User@Example.COM ", password: "longenough" });
    expect(parsed.email).toBe("user@example.com");
  });

  it("rejects short passwords", () => {
    expect(() => signupSchema.parse({ email: "a@b.com", password: "short" })).toThrow();
  });

  it("rejects invalid emails", () => {
    expect(() => loginSchema.parse({ email: "nope", password: "x" })).toThrow();
  });

  it("requires a non-empty agent message and bounds its length", () => {
    expect(() => agentRequestSchema.parse({ message: "" })).toThrow();
    expect(agentRequestSchema.parse({ message: "hello" }).message).toBe("hello");
  });

  it("bounds memory content", () => {
    expect(() => memoryInputSchema.parse({ content: "" })).toThrow();
    expect(memoryInputSchema.parse({ content: "my company is X" }).content).toBe("my company is X");
  });
});
