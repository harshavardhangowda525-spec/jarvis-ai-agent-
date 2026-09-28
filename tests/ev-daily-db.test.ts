import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getDb, isDbConfigured } from "@/lib/db";
import type { DailyDeps } from "@/lib/ev/daily/pipeline";

const d = isDbConfigured ? describe : describe.skip;
const TZ = "Asia/Kolkata";

/** A real (tiny) 9:16 MP4 for the fake renderer to hand back. */
function tinyReel(): Buffer | null {
  const bin = path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg");
  if (!existsSync(bin)) return null;
  const out = path.join(mkdtempSync(path.join(os.tmpdir(), "evtest-")), "r.mp4");
  const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=navy:s=1080x1920:r=30:d=12", "-f", "lavfi", "-t", "12", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out]);
  return r.status === 0 ? readFileSync(out) : null;
}

const TEMPLATES = [
  (n: string, sv: string) => ({
    topic: `Why ${n} lose walk-ins without ${sv.toLowerCase()}`,
    hook: `${n}: customers can't find you online`,
    caption: `Most ${n} customers search online before they walk in. If they can't see your hours, prices or a way to book, they pick someone else.\n\nInfinity Web & Apps builds ${sv.toLowerCase()} for ${n} that show up, load fast and turn searches into bookings. Websites from ₹4,999.\n\nWant yours? Call 8317480583 or DM @infinitywebapps.`,
    beats: ["Customers search online before they visit", "A booking site turns searches into visits"],
  }),
  (n: string, sv: string) => ({
    topic: `The Sunday-night paperwork trap for ${n}`,
    hook: `Still doing invoices by hand at midnight?`,
    caption: `Picture closing the shutters, then spending two hours copying orders into a notebook. That's the hidden shift most ${n} owners work every week.\n\nWith ${sv.toLowerCase()} from Infinity Web & Apps, orders, reminders and receipts sort themselves while you rest. You get your evenings back and fewer mistakes slip through.\n\nTell us how you work today — call 8317480583.`,
    beats: ["Orders logged the moment they arrive", "Reminders go out without you"],
  }),
  (n: string, sv: string) => ({
    topic: `Myth: ${n} are too small for an app`,
    hook: `"We're too small for an app" — are you?`,
    caption: `A regular who reorders every week doesn't care how big you are. They care that ordering from you takes ten seconds.\n\nInfinity Web & Apps designs simple ${sv.toLowerCase()} for ${n}: saved favourites, quick reorders, loyalty stamps on the phone. Apps from ₹55,000.\n\nCurious what yours would look like? Message @infinitywebapps or call 8317480583.`,
    beats: ["Regulars reorder in a single tap", "Loyalty lives on their phone"],
  }),
  (n: string, sv: string) => ({
    topic: `Before and after: a ${n} redesign that finally books`,
    hook: `Your old website is quietly turning people away`,
    caption: `Tiny text, a broken menu link, no button to book. Visitors bounce in seconds and you never hear about it.\n\nInfinity Web & Apps redesigns tired sites for ${n} into clean, mobile-first pages with one clear action: book, order or call. Same business, new first impression, built around ${sv.toLowerCase()}.\n\nSend us your current site for a free look — 8317480583.`,
    beats: ["Before: confusing, slow, no booking", "After: one tap to book"],
  }),
];

function planFor(user: string, variantTopic?: string) {
  const niche = user.match(/Target niche: (.+)/)?.[1]?.trim() ?? "gyms";
  const service = user.match(/Service to feature: (.+)/)?.[1]?.trim() ?? "Business websites";
  const idx = [...niche].reduce((a, c) => a + c.charCodeAt(0), 0) % TEMPLATES.length;
  const t = TEMPLATES[(idx + planCalls++) % TEMPLATES.length](niche, service);
  return JSON.stringify({
    ...t,
    topic: variantTopic ?? t.topic,
    angle: `Owners of ${niche} miss customers and time.`,
    contentType: "Educational Reel + post",
    cta: "Call 8317480583 to get started",
    hashtags: ["#smallbusiness", `#${niche.replace(/\s/g, "")}`, "#localbusiness", "#InfinityWebApps", "#digitalgrowth", "#smallbusinessowner"],
    creativeConcept: `A ${niche} owner and their customers — ${t.beats.join(", ").toLowerCase()} — shown in a warm, cinematic scene about ${t.topic.toLowerCase()}.`,
    imagePrompt: `Cinematic photo of a modern ${niche} interior, owner holding a phone, neon accents`,
    videoConcept: `Open on "${t.hook}", show the ${niche} problem, then ${t.beats[1].toLowerCase()}, CTA to call.`,
  });
}
let planCalls = 0;

d("EV daily content pipeline (integration)", () => {
  let userId = "";
  let P: typeof import("@/lib/ev/daily/pipeline");
  let reelBytes: Buffer | null = null;
  let imageBytes: Buffer;
  let clock = new Date();
  const writes: string[] = [];
  let writeOverride: ((user: string) => string) | null = null;
  let imageFail: Error | null = null;
  const deps = (): DailyDeps => ({
    now: () => clock,
    write: async (_s, user) => { writes.push(user); return writeOverride ? writeOverride(user) : user.startsWith("Current package") ? JSON.stringify({ caption: "Rewritten caption for owners who want more bookings online. Infinity Web & Apps builds booking websites that customers actually find, so searches turn into visits.\n\nCall 8317480583.", hashtags: ["#smallbusiness", "#localbusiness", "#InfinityWebApps", "#onlinebooking"], hook: "Customers search first, then visit", cta: "Call 8317480583 today", beats: ["They search before they walk in", "Be the one they find"], videoConcept: "A new story: the search, the empty counter, the booking site, the call." }) : planFor(user); },
    image: async () => { if (imageFail) throw imageFail; return { bytes: imageBytes, mimeType: "image/png", provider: "test-image" }; },
    reel: async (input) => { if (!reelBytes) throw new Error("no ffmpeg"); return { bytes: reelBytes, seconds: input.seconds ?? 12, width: 1080, height: 1920, mimeType: "video/mp4" as const }; },
    magicHour: null,
    publicUrl: true,
  });

  beforeAll(async () => {
    P = await import("@/lib/ev/daily/pipeline");
    reelBytes = tinyReel();
    imageBytes = await sharp({ create: { width: 1024, height: 1280, channels: 3, background: { r: 30, g: 40, b: 110 } } }).png().toBuffer();
    const u = await getDb().user.create({ data: { email: `evd-${Date.now()}@example.com`, passwordHash: "x", profile: { create: { timezone: TZ } } } });
    userId = u.id;
    // a past package so anti-repetition has something to avoid
    await getDb().evDaily.create({ data: { userId, date: "2026-01-01", status: "published", stage: "done", niche: "gyms", service: "Business websites", format: "Problem → solution", topic: "Why gyms owners lose walk-ins without business websites", hook: "Gyms owners: customers can't find you online", caption: "old", hashtags: [], beats: [] } });
  }, 60_000);
  afterAll(async () => { await getDb().user.deleteMany({ where: { id: userId } }).catch(() => {}); });

  const today = () => P.dailyConfig().tz && new Intl.DateTimeFormat("en-CA", { timeZone: P.dailyConfig().tz }).format(clock);

  it("runs the morning schedule end to end: plan → image → Reel → QC → READY", async () => {
    if (!reelBytes) return;
    // 04:05 IST
    const t = today();
    clock = new Date(`${t}T04:05:00+05:30`);
    const r = await P.runSchedule({ userIds: [userId], deps: deps(), budgetMs: 60_000 });
    expect(r.due).toBe(true);
    const p = (await P.currentPackage(userId, t))!;
    expect(p.status).toBe("ready");
    expect(p.niche).not.toBe("gyms"); // rotated away from the last package
    expect(p.imageUrl).toMatch(/\/api\/ev\/media\//);
    expect(p.videoUrl).toMatch(/kind=video/);
    expect(p.videoSeconds).toBe(12);
    expect((p.qc as { passed: boolean }).passed).toBe(true);
    const steps = (p.log as { step: string }[]).map((e) => e.step);
    expect(steps).toEqual(expect.arrayContaining(["research", "content", "creative", "video", "qc", "ready"]));
    // mirrored into EV's memory + recorded for the briefing
    const content = await getDb().evContent.findUnique({ where: { id: p.contentId! } });
    expect(content?.status).toBe("ready");
    const acts = await getDb().activityEvent.findMany({ where: { userId, agent: "EV" } });
    expect(acts.some((a) => /Prepared the .* Instagram content/.test(a.action))).toBe(true);
    // the view shows true step state
    const v = await P.dailyView(userId, deps());
    expect(v.pkg!.steps.every((s) => s.state === "done")).toBe(true);
    expect(v.pkg!.stream).toBe("READY");
  }, 60_000);

  it("approval never fakes a publish when Instagram isn't connected", async () => {
    if (!reelBytes) return;
    const t = today();
    const a = await P.applyAction(userId, t, { action: "approve" }, deps());
    expect(a.pkg.status).toBe("approved");
    const p = await P.advance(a.pkg.id, { deps: deps(), budgetMs: 30_000 });
    expect(p.status).toBe("approved");
    expect(p.publishedAt).toBeNull();
    expect(p.publishError ?? "").toMatch(/Instagram isn't connected|INSTAGRAM_ACCESS_TOKEN/);
  }, 60_000);

  it("rejecting creates a new, different version; a duplicate draft is rewritten", async () => {
    if (!reelBytes) return;
    const t = today();
    const v1 = (await P.currentPackage(userId, t))!;
    const r = await P.applyAction(userId, t, { action: "reject", instruction: "Reject it" }, deps());
    expect(r.pkg.version).toBe(2);
    const old = await getDb().evDaily.findUnique({ where: { id: v1.id } });
    expect(old!.status).toBe("rejected");
    expect(old!.current).toBe(false);
    // first draft repeats v1's topic → must be rewritten
    let n = 0;
    writeOverride = (user) => (++n === 1 ? planFor(user, v1.topic) : planFor(user));
    const p = await P.advance(r.pkg.id, { deps: deps(), budgetMs: 60_000 });
    writeOverride = null;
    expect(p.error).toBeNull();
    expect(p.status).toBe("ready");
    expect(p.topic).not.toBe(v1.topic);
    expect(p.niche).not.toBe(v1.niche);
    expect((p.log as { text: string }[]).some((e) => /too close/.test(e.text))).toBe(true);
  }, 60_000);

  it("caption and video revisions make new versions and keep the rest", async () => {
    if (!reelBytes) return;
    const t = today();
    const cur = (await P.currentPackage(userId, t))!;
    const mine = "Your customers are searching right now. Infinity Web & Apps builds fast booking websites for local businesses so every search becomes a visit. Call 8317480583 or DM @infinitywebapps to start this week.";
    const c = await P.applyAction(userId, t, { action: "caption", caption: mine, instruction: "Change the caption to …" }, deps());
    expect(c.pkg.stage).toBe("qc");
    const afterCap = await P.advance(c.pkg.id, { deps: deps(), budgetMs: 30_000 });
    expect(afterCap.error).toBeNull();
    expect(afterCap.status).toBe("ready");
    expect(afterCap.caption).toBe(mine);
    expect(afterCap.imageMediaId).toBe(cur.imageMediaId);

    const v = await P.applyAction(userId, t, { action: "video", instruction: "Change the video" }, deps());
    expect(v.pkg.variant).toBe(afterCap.variant + 1);
    const afterVid = await P.advance(v.pkg.id, { deps: deps(), budgetMs: 30_000 });
    expect(afterVid.status).toBe("ready");
    expect(afterVid.videoMediaId).not.toBe(afterCap.videoMediaId);
    expect(afterVid.caption).toBe(afterCap.caption);
  }, 60_000);

  it("a failed step shows the real error, then retry resumes", async () => {
    if (!reelBytes) return;
    const t = today();
    const r = await P.applyAction(userId, t, { action: "another" }, deps());
    imageFail = new P.DailyError("Image generation isn't configured. Set GEMINI_API_KEY.", true);
    const failed = await P.advance(r.pkg.id, { deps: deps(), budgetMs: 30_000 });
    expect(failed.status).toBe("failed");
    expect(failed.stage).toBe("image");
    expect(failed.error).toMatch(/GEMINI_API_KEY/);
    expect(failed.imageUrl).toBeNull();
    const view = await P.dailyView(userId, deps());
    expect(view.pkg!.steps.find((s) => s.key === "creative")!.state).toBe("failed");
    imageFail = null;
    const again = await P.applyAction(userId, t, { action: "retry" }, deps());
    const done = await P.advance(again.pkg.id, { deps: deps(), budgetMs: 60_000 });
    expect(done.status).toBe("ready");
  }, 60_000);

  it("before the start time nothing is created", async () => {
    const early = new Date(`2030-05-05T03:10:00+05:30`);
    clock = early;
    const r = await P.runSchedule({ userIds: [userId], deps: deps(), budgetMs: 10_000 });
    expect(r.due).toBe(false);
    expect(await P.currentPackage(userId, "2030-05-05")).toBeNull();
  });
});
