import { describe, it, expect } from "vitest";
import { classifyTool, goalIntent, toolNode } from "@/lib/ultron-visual";

describe("ULTRON motion state from real runtime activity", () => {
  it("maps each tool to what ULTRON is visibly doing", () => {
    expect(classifyTool("ultron.write_file")).toBe("coding");
    expect(classifyTool("ultron.edit_file")).toBe("coding");
    expect(classifyTool("ultron.build")).toBe("building");
    expect(classifyTool("ultron.install")).toBe("building");
    expect(classifyTool("ultron.test")).toBe("debugging");
    expect(classifyTool("ultron.deploy")).toBe("deploying");
    expect(classifyTool("ultron.read_file")).toBe("thinking");
    expect(classifyTool("ultron.git_status")).toBe("thinking");
  });

  it("reads shell commands for their intent", () => {
    expect(classifyTool("ultron.run_command", "Run: npm run build")).toBe("building");
    expect(classifyTool("ultron.run_command", "Run: npx vitest run")).toBe("debugging");
    expect(classifyTool("ultron.run_command", "Run: npm run deploy")).toBe("deploying");
    expect(classifyTool("ultron.run_command", "Run: vercel --prod")).toBe("deploying");
    expect(classifyTool("ultron.run_command", "Run: ls -la")).toBe("thinking");
  });

  it("lights the right side system", () => {
    expect(toolNode("ultron.read_file")).toBe("MEMORY");
    expect(toolNode("ultron.write_file")).toBe("REPOSITORY");
    expect(toolNode("ultron.git_commit")).toBe("REPOSITORY");
    expect(toolNode("ultron.run_command", "npm test")).toBe("TERMINAL");
    expect(toolNode("ultron.deploy")).toBe("DEPLOYMENT");
  });

  it("a fix-it goal keeps the debugging scan between steps", () => {
    expect(goalIntent("Fix the login bug")).toBe("debugging");
    expect(goalIntent("Build a pricing page")).toBe("thinking");
  });
});
