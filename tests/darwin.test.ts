import { describe, it, expect } from "vitest";
import { availableTools, getTool } from "@/lib/tools/registry";
import { leadFingerprint, domainOf, normalizePhone } from "@/lib/darwin/dedup";

describe("DARWIN tool scoping", () => {
  const DARWIN_TOOLS = ["darwin_search", "darwin_leads", "darwin_stage", "darwin_qualify", "darwin_note", "darwin_followup", "darwin_outreach", "darwin_message"];

  it("hides DARWIN tools from the base JARVIS toolset and from EV", () => {
    const base = availableTools().map((t) => t.name);
    const ev = availableTools("ev").map((t) => t.name);
    for (const t of DARWIN_TOOLS) { expect(base).not.toContain(t); expect(ev).not.toContain(t); }
  });

  it("exposes DARWIN tools only when the darwin agent is active", () => {
    const names = availableTools("darwin").map((t) => t.name);
    for (const t of DARWIN_TOOLS) expect(names).toContain(t);
    expect(names).toContain("memory"); // shares general tools
  });

  it("gates the outbound message tool behind confirmation", () => {
    expect(getTool("darwin_message")!.requiresConfirmation).toBe(true);
  });

  it("every DARWIN tool is registered, agent-scoped and schema-valid", () => {
    for (const name of DARWIN_TOOLS) {
      const tool = getTool(name)!;
      expect(tool).toBeDefined();
      expect(tool.agentScope).toBe("darwin");
      expect(tool.inputSchema).toHaveProperty("type", "object");
    }
  });
});

describe("DARWIN duplicate protection", () => {
  it("extracts a clean domain", () => {
    expect(domainOf("https://www.CafeMocha.in/menu")).toBe("cafemocha.in");
    expect(domainOf("cafemocha.in")).toBe("cafemocha.in");
  });

  it("fingerprints the same business (by domain) identically across discoveries", () => {
    const a = leadFingerprint({ businessName: "Cafe Mocha", website: "https://cafemocha.in", location: "Bengaluru" });
    const b = leadFingerprint({ businessName: "CAFE  MOCHA (MG Road)", website: "http://www.cafemocha.in/", location: "Bengaluru, KA" });
    expect(a).toBe(b);
  });

  it("distinguishes different businesses", () => {
    const a = leadFingerprint({ businessName: "Cafe Mocha", website: "cafemocha.in" });
    const b = leadFingerprint({ businessName: "Brew House", website: "brewhouse.in" });
    expect(a).not.toBe(b);
  });

  it("falls back to phone (format-insensitive) when there's no website", () => {
    // Same underlying number in different formats → same business.
    const byPhone = leadFingerprint({ businessName: "X", phone: "+91 98765 43210" });
    const byPhone2 = leadFingerprint({ businessName: "Y", phone: "+91-98765-43210" });
    expect(byPhone).toBe(byPhone2);
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
  });

  it("uses name+location only when no stronger identifier exists", () => {
    const a = leadFingerprint({ businessName: "Corner Cafe", location: "Indiranagar" });
    const b = leadFingerprint({ businessName: "corner cafe", location: "INDIRANAGAR" });
    expect(a).toBe(b);
  });
});
