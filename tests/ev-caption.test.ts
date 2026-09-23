import { describe, it, expect } from "vitest";
import { extractCaption } from "@/components/console/ev-view";

const REPLY = `CONTENT READY
**Preview:** Sleek laptop mockup showing a cafe website, warm lighting.
**Caption:** "Your cafe deserves more than a Google listing ☕ Get a stunning website from just ₹4,999."
**CTA:** DM @infinitywebapps or call 8317480583
**Hashtags:** #WebDesign #CafeMarketing #SmallBusiness
Want me to publish it?`;

describe("EV caption extraction", () => {
  it("posts caption + CTA + hashtags, not the whole briefing", () => {
    expect(extractCaption(REPLY)).toBe(
      "Your cafe deserves more than a Google listing ☕ Get a stunning website from just ₹4,999.\n\n" +
      "DM @infinitywebapps or call 8317480583\n\n" +
      "#WebDesign #CafeMarketing #SmallBusiness",
    );
  });
  it("never includes EV's follow-up question or the preview line", () => {
    const c = extractCaption(REPLY);
    expect(c).not.toMatch(/want me to|preview|content ready/i);
  });
  it("falls back to the reply text when there's no Caption field", () => {
    expect(extractCaption("Here is a fresh cafe promo graphic.\nWant me to publish it?")).toBe("Here is a fresh cafe promo graphic.");
  });
  it("is empty when EV hasn't replied yet", () => {
    expect(extractCaption("")).toBe("");
  });
});
