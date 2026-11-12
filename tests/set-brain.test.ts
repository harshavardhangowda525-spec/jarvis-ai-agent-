import { describe, it, expect } from "vitest";
import { switchBrain } from "../scripts/set-brain.mjs";

describe("switching JARVIS's main brain (.env.local)", () => {
  it("Groq first, Gemini as backup, Claude off — keys untouched", () => {
    const before = 'GROQ_API_KEY=gsk_secret\nAI_PROVIDER=claude\nCLAUDE_FOR_ALL_AGENTS=1\nJARVIS_PROVIDER=claude,groq\nEV_PROVIDER="claude>gemini"\n# note\n';
    const after = switchBrain(before, "groq");
    expect(after).toContain("GROQ_API_KEY=gsk_secret\n");
    expect(after).toContain("AI_PROVIDER=groq\n");
    expect(after).toContain("CLAUDE_FOR_ALL_AGENTS=0\n");
    expect(after).toContain("JARVIS_PROVIDER=groq,gemini\n");
    expect(after).toContain("EV_PROVIDER=groq,gemini\n");
    expect(after).toContain("# note\n");
    expect(after).not.toMatch(/claude,|=claude/);
  });
  it("adds the settings when they weren't there, and can switch back to Claude", () => {
    expect(switchBrain("GEMINI_API_KEY=x\n", "groq")).toBe("GEMINI_API_KEY=x\nAI_PROVIDER=groq\nCLAUDE_FOR_ALL_AGENTS=0\n");
    expect(switchBrain("AI_PROVIDER=groq\nCLAUDE_FOR_ALL_AGENTS=0\n", "claude")).toBe("AI_PROVIDER=groq\nCLAUDE_FOR_ALL_AGENTS=1\n");
  });
});
