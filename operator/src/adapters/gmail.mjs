import { observe } from "../browser/observe.mjs";
import { executeAction } from "../browser/actions.mjs";
import { runGeneric } from "./generic.mjs";
import { log } from "../log.mjs";

/**
 * GmailAdapter — opens Gmail in the visible browser, checks login state, then
 * uses the generic agent loop to compose the email. The final "Send" click is a
 * HIGH-risk action, so the risk gate forces an explicit confirmation before it
 * runs — we never send without a yes. We never handle passwords/OTP: if Gmail
 * isn't logged in, we stop and ask the user to log in manually.
 */
export async function runGmail(ctx) {
  const { mgr, emit } = ctx;

  emit({ kind: "activity", label: "Opening Gmail…" });
  await executeAction(mgr, { type: "navigate", url: "https://mail.google.com/mail/u/0/" });

  const page = await mgr.activePage();
  await page.waitForTimeout(1500);
  const snap = await observe(page);

  if (isLoggedOut(snap)) {
    emit({
      kind: "needUser",
      message: "Gmail isn't logged in. Please sign in to Gmail in the browser window, then run the command again.",
    });
    return { ok: false, needUser: true, message: "Please log into Gmail manually." };
  }

  emit({ kind: "activity", label: "Gmail is open and you're signed in." });
  // Hand off to the generic loop with an explicit, safe goal. The generic loop's
  // risk gate will pause before clicking Send.
  return runGeneric({ ...ctx, goal: gmailGoal(ctx.goal) }, { maxSteps: 22 });
}

function isLoggedOut(snap) {
  const u = snap.url || "";
  if (/accounts\.google\.com|\/signin|\/ServiceLogin/i.test(u)) return true;
  const t = (snap.textPreview || "").toLowerCase();
  if (/sign in|use your google account|enter your email/.test(t) && !/inbox|compose/i.test(t)) return true;
  return false;
}

function gmailGoal(goal) {
  return (
    `In the already-open Gmail, ${goal}. ` +
    `Click "Compose", fill the To (recipient), Subject, and Message body appropriately, ` +
    `then STOP so the user can confirm before sending. Do not click Send yourself — ` +
    `the orchestrator will send only after explicit confirmation.`
  );
}

export { log };
