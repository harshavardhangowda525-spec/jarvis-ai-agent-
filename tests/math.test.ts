import { describe, it, expect } from "vitest";
import { evaluateExpression } from "@/lib/tools/mathEval";
import { calculatorTool } from "@/lib/tools/calculator";

const ctx = { userId: "u", timezone: "UTC", activity: () => {} };

describe("evaluateExpression", () => {
  it("does basic arithmetic", () => {
    expect(evaluateExpression("55000 + 18000")).toBe(73000);
    expect(evaluateExpression("100 - 42")).toBe(58);
    expect(evaluateExpression("6 * 7")).toBe(42);
    expect(evaluateExpression("84 / 2")).toBe(42);
  });

  it("respects operator precedence and parentheses", () => {
    expect(evaluateExpression("2 + 3 * 4")).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4")).toBe(20);
  });

  it("handles powers and functions", () => {
    expect(evaluateExpression("45^2")).toBe(2025);
    expect(evaluateExpression("sqrt(144)")).toBe(12);
    expect(evaluateExpression("abs(-9)")).toBe(9);
  });

  it("handles percentages", () => {
    expect(evaluateExpression("25000 * 18%")).toBe(4500);
    expect(evaluateExpression("18%")).toBeCloseTo(0.18);
  });

  it("supports the × and ÷ symbols", () => {
    expect(evaluateExpression("6 × 7")).toBe(42);
    expect(evaluateExpression("84 ÷ 2")).toBe(42);
  });

  it("throws on division by zero", () => {
    expect(() => evaluateExpression("1 / 0")).toThrow(/zero/i);
  });

  it("rejects unknown identifiers and injection attempts", () => {
    expect(() => evaluateExpression("process.exit(1)")).toThrow();
    expect(() => evaluateExpression("require('fs')")).toThrow();
    expect(() => evaluateExpression("2 +")).toThrow();
  });
});

describe("calculatorTool", () => {
  it("returns a rounded result and summary", async () => {
    const res = await calculatorTool.execute({ expression: "55000 + 18000" }, ctx);
    expect((res.data as any).result).toBe(73000);
    expect(res.summary).toContain("73000");
  });

  it("throws a user-facing ToolError on invalid input", async () => {
    await expect(
      calculatorTool.execute({ expression: "!!!" }, ctx),
    ).rejects.toThrow();
  });
});
