import { z } from "zod";
import type { ToolDefinition } from "./types";
import { ToolError } from "./types";
import { resolveSite } from "@/lib/open-site";

// Plain strings (no enum / URL format) on purpose: small local models write
// "amazon", "amazon.in" or "www.flipkart.com" — all of which should just work.
const schema = z.object({
  site: z.string().max(200).optional().describe("Site name or address, e.g. amazon, youtube, flipkart, gmail, maps, amazon.in, example.com."),
  url: z.string().max(2000).optional().describe("A full web address, if you have one."),
  search: z.string().max(300).optional().describe("Optional: something to search for on that site (e.g. 'wireless earbuds' on amazon)."),
});

/**
 * Opens a website in the user's browser (new tab). The agent surfaces this as
 * an `open` action; the client opens it and always shows a clickable link
 * (browsers block pop-ups that aren't started by a click).
 */
export const openLinkTool: ToolDefinition<z.infer<typeof schema>> = {
  name: "open_link",
  description:
    "Open a website in the user's browser — any site: Amazon, Flipkart, YouTube, Gmail, Maps, Netflix, Instagram, " +
    "GitHub, or any address like example.com. Give the site name (and optionally what to search for on it). " +
    "Use whenever the user says 'open …', 'go to …' or 'search <site> for …'. For reading/sending email or " +
    "managing calendar events use the gmail / google_calendar tools — this only opens the page.",
  schema,
  inputSchema: {
    type: "object",
    properties: {
      site: { type: "string", description: "Site name or address, e.g. amazon, youtube, flipkart, amazon.in" },
      url: { type: "string", description: "A full https address, if you have one." },
      search: { type: "string", description: "What to search for on the site (optional)." },
    },
  },
  activityLabel: "Opening website",
  async execute(input, ctx) {
    const india = /^Asia\/(Kolkata|Calcutta)$/.test(ctx.timezone ?? "");
    const target =
      (input.url && resolveSite(input.url, input.search, { india })) ||
      (input.site && resolveSite(input.site, input.search, { india }));
    if (!target) {
      const asked = (input.site || input.url || "").trim();
      if (!asked) throw new ToolError("Tell me which site or address to open.");
      if (/^(javascript|data|file|vbscript):/i.test(asked)) throw new ToolError("Only web addresses can be opened.");
      // An unknown name: a Google search for it is the honest best guess.
      const q = [asked, input.search].filter(Boolean).join(" ");
      return {
        data: { openUrl: `https://www.google.com/search?q=${encodeURIComponent(q)}`, label: `Google: ${q}` },
        summary: `I don't know the address for "${asked}", so I opened a Google search for it.`,
      };
    }
    return {
      data: { openUrl: target.url, label: target.label },
      summary: `Opening ${target.label}${input.search ? ` (search: ${input.search})` : ""}.`,
    };
  },
};
