import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { pickTools, stripSchema } from "@/lib/ai/tool-pick";
import { compactManual, INFINITY_TEMPLATE } from "@/lib/ai/operator";

const tools = ["get_time", "memory", "computer_task", "call_me", "crm_leads", "crm_plan_calls", "portal_overview", "portal_reply", "mike_chart", "nios"].map((name) => ({ name }));

describe("small AI plans (Groq free): only the tools a message needs", () => {
  it("core tools always; CRM / portal / markets only when they come up", () => {
    const names = (m: string, recent: string[] = []) => pickTools(tools, m, recent).map((t) => t.name);
    expect(names("give me a test call")).toEqual(["get_time", "memory", "computer_task", "call_me"]);
    expect(names("call today's leads")).toContain("crm_plan_calls");
    expect(names("who owes me money in the portal?")).toEqual(expect.arrayContaining(["portal_overview", "portal_reply"]));
    expect(names("yes send it", ["reply to Ravi in the portal that the preview is ready"])).toContain("portal_reply");
    expect(names("show me the nifty chart")).toContain("mike_chart");
    expect(names("open Chrome and search hi world")).not.toContain("crm_leads");
  });
  it("drops parameter descriptions but keeps names, types and choices", () => {
    expect(stripSchema({ type: "object", properties: { focus: { type: "string", enum: ["a", "b"], description: "long text" } }, required: ["focus"] }))
      .toEqual({ type: "object", properties: { focus: { type: "string", enum: ["a", "b"] } }, required: ["focus"] });
  });
  it("keeps the manual's core (who you are, personality, golden rules, hard stops)", () => {
    const c = compactManual(INFINITY_TEMPLATE);
    expect(c).toContain("PART 0");
    expect(c).toContain("Hard stops");
    expect(c).not.toContain("PART 3");
    expect(c.length).toBeLessThan(6000);
  });
});
