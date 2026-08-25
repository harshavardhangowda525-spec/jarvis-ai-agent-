import { runGmail } from "./adapters/gmail.mjs";
import { runGoogle, runYouTube, runOpenSite } from "./adapters/simple.mjs";
import { runGeneric } from "./adapters/generic.mjs";

/**
 * Command Router — maps the planned application to the adapter that executes it.
 * Unknown/other applications fall back to the generic web agent, so JARVIS is
 * never limited to a hard-coded list of sites.
 */
export async function route(application, ctx) {
  switch (application) {
    case "gmail":
      return runGmail(ctx);
    case "google":
      return runGoogle(ctx);
    case "youtube":
      return runYouTube(ctx);
    case "calendar":
      // Google Calendar: open it, then let the generic agent create the event
      // (event creation is MODERATE and gated by the risk system).
      return runOpenSite({ ...ctx, goal: `${ctx.goal}. Use https://calendar.google.com/` }, "https://calendar.google.com/");
    case "instagram":
      return runOpenSite({ ...ctx, goal: ctx.goal }, "https://www.instagram.com/");
    case "whatsapp":
      return runOpenSite({ ...ctx, goal: ctx.goal }, "https://web.whatsapp.com/");
    case "generic":
    default:
      return runOpenSite(ctx);
  }
}
