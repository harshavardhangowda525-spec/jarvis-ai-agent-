import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { evaluateExpression } from "./mathEval";

const schema = z.object({
  expression: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "A pure arithmetic expression to evaluate, e.g. '55000 + 18000', " +
        "'25000 * 18%', '45^2', 'sqrt(144)'. For unit conversions, provide " +
        "the arithmetic (e.g. 5 km to miles => '5 * 0.621371').",
    ),
});

export const calculatorTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "calculator",
  description:
    "Evaluate a mathematical expression precisely. Use this for ANY arithmetic " +
    "instead of computing in your head. Supports + - * / ^ %, parentheses, and " +
    "functions sqrt, abs, sin, cos, tan, log, ln, round, floor, ceil, exp, plus " +
    "constants pi and e.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      expression: {
        type: "string",
        description:
          "Arithmetic expression, e.g. '55000 + 18000' or '25000 * 18%'.",
      },
    },
    required: ["expression"],
  },
  activityLabel: "Running calculator",
  async execute({ expression }) {
    try {
      const result = evaluateExpression(expression);
      const rounded = Math.round(result * 1e10) / 1e10;
      return {
        data: { expression, result: rounded },
        summary: `${expression} = ${rounded}`,
      };
    } catch (err) {
      throw new ToolError(
        `Could not evaluate "${expression}": ${
          err instanceof Error ? err.message : "invalid expression"
        }`,
      );
    }
  },
};
