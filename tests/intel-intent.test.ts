import { describe, it, expect } from "vitest";
import { businessEnvCommand } from "@/lib/intel/intent";

describe("business environment voice command", () => {
  it.each([
    "open business environment", "Jarvis, open the business environment", "Hey Jarvis, how's the business environment?", "how is the business environment",
    "house business environment", "house the business environment", "hows business environment today", "show me the business environment dashboard",
    "open the command center", "what's happening in the business environment", "business environment", "brief me on the business environment", "give me the business briefing",
  ])("opens for %s", (t) => expect(businessEnvCommand(t)).toBe(true));
  it.each([
    "build a website for my business", "how is my business doing in the CRM", "open the teleprompter", "what is the environment variable for stripe", "open business email",
  ])("leaves %s alone", (t) => expect(businessEnvCommand(t)).toBe(false));
});
