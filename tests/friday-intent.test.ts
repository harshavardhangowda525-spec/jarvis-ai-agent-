import { describe, it, expect } from "vitest";
import { modeCommand, isFridayActivation, fridayCommand } from "@/lib/friday/intent";

describe("agentic view switch", () => {
  it("the exact commands switch", () => {
    expect(modeCommand("activate agentic view")).toBe("activate");
    expect(modeCommand("deactivate agentic view")).toBe("deactivate");
    expect(modeCommand("Activate Agentic View.")).toBe("activate");
  });
  it("natural equivalents switch too", () => {
    for (const s of ["Friday, open the agentic workspace", "switch to agentic mode", "show me the holographic view", "enter 3D mode please", "go agentic", "could you activate agentic mode", "open the 3d workspace"]) expect(modeCommand(s), s).toBe("activate");
    for (const s of ["exit agentic view", "close the agentic workspace", "back to chat", "go back to the normal chat", "return to chat mode", "turn off holographic view", "Friday, leave agentic mode"]) expect(modeCommand(s), s).toBe("deactivate");
  });
  it("talking about the phrase never switches", () => {
    for (const s of [
      "what does activate agentic view do?", "how do I activate agentic view", "don't activate agentic view yet",
      "type 'activate agentic view' to switch", 'say "deactivate agentic view" later', "I might activate agentic view tomorrow",
      "explain the agentic view", "the agentic view looks great", "activate agentic view and also make it red", "make a 3D view of the hinge",
    ]) expect(modeCommand(s), s).toBeNull();
  });
});

describe("JARVIS → Friday", () => {
  it("opens Friday by name, but not on weekday talk", () => {
    for (const s of ["Friday", "open Friday", "Jarvis, activate Friday", "talk to Friday", "friday, are you there"]) expect(isFridayActivation(s), s).toBe(true);
    for (const s of ["remind me on Friday", "open friday's meeting notes", "what's on this Friday", "Friday at 5 pm", "open friday at 9"]) expect(isFridayActivation(s), s).toBe(false);
  });
  it("hands modelling work to Friday", () => {
    expect(fridayCommand("Friday, model the EDITH smart glasses")).toBe("model the EDITH smart glasses");
    expect(fridayCommand("Jarvis, ask Friday to render the drone in blue")).toBe("render the drone in blue");
    expect(fridayCommand("make a 3D model of a coffee grinder")).toBe("make a 3D model of a coffee grinder");
    expect(fridayCommand("render my invention in 3D")).toBe("render my invention in 3D");
    for (const s of ["Friday at 5 pm I have a meeting", "what is a 3D model?", "remind me on Friday to build the site", "build a website for my cafe", "on Friday make the report"]) expect(fridayCommand(s), s).toBeNull();
  });
});

import { viewCommand } from "@/lib/friday/intent";
describe("instant view commands", () => {
  it("camera, shading, explode, section — handled without the AI", () => {
    expect(viewCommand("top view")).toEqual({ kind: "preset", preset: "top" });
    expect(viewCommand("Friday, show me the back")).toEqual({ kind: "preset", preset: "rear" });
    expect(viewCommand("wireframe")).toEqual({ kind: "shading", shading: "wireframe" });
    expect(viewCommand("explode it")).toEqual({ kind: "explode", amount: 1 });
    expect(viewCommand("put it back together")).toEqual({ kind: "explode", amount: 0 });
    expect(viewCommand("show the inside")).toEqual({ kind: "section", on: true });
    expect(viewCommand("reset view")).toEqual({ kind: "reset" });
    expect(viewCommand("orthographic")).toEqual({ kind: "projection", ortho: true });
    expect(viewCommand("open the render gallery")).toEqual({ kind: "gallery" });
  });
  it("model changes go to Friday's brain", () => {
    for (const s of ["make the top thinner", "re-render the top view", "change the front to matte black", "export an STL", "the front view looks too dark, fix the lighting"]) expect(viewCommand(s), s).toBeNull();
  });
});
