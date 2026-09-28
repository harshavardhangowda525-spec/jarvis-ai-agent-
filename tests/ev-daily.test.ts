import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { parseDailyCommand } from "@/lib/ev/daily/intent";
import { qualityCheck, findFakeClaims, brandIssues, findPlaceholders, type QcInput } from "@/lib/ev/daily/qc";
import { stepStates, plannedTimes, activeStream, autostartDue, localClock, clockLabel, hm } from "@/lib/ev/daily/schedule";
import { chooseAngle, leastRecent, parsePlan, parseRevision, cleanHashtags, cleanCaption, extractJson, type PriorPackage } from "@/lib/ev/daily/plan";
import { reelTimeline, probeMp4, renderReel } from "@/lib/ev/daily/reel";
import { evTodaySentence } from "@/lib/briefing/build";
import { spokenStatus, type DailyView } from "@/lib/ev/daily/view";

describe("daily content commands", () => {
  it("recognises every approval phrase", () => {
    for (const t of ["Approved", "Publish it", "Go ahead", "Looks good", "approve it", "publish it now", "Looks good to me.", "yes, publish it"]) {
      expect(parseDailyCommand(t), t).toEqual({ action: "approve" });
    }
    expect(parseDailyCommand("yes")).toEqual({ action: "approve", weak: true });
    expect(parseDailyCommand("not yet")).toEqual({ action: "decline", weak: true });
  });
  it("routes revisions before approval", () => {
    expect(parseDailyCommand("Reject it")?.action).toBe("reject");
    expect(parseDailyCommand("Regenerate it")?.action).toBe("regenerate");
    expect(parseDailyCommand("Change the caption")?.action).toBe("caption");
    expect(parseDailyCommand("Change the video")?.action).toBe("video");
    expect(parseDailyCommand("Show me another idea")?.action).toBe("another");
    expect(parseDailyCommand("Make it more professional")).toMatchObject({ action: "tone", tone: "more professional" });
    expect(parseDailyCommand("Make it more engaging")).toMatchObject({ action: "tone", tone: "more engaging" });
    expect(parseDailyCommand("retry")).toEqual({ action: "retry" });
    expect(parseDailyCommand("show me today's content")).toEqual({ action: "show" });
    expect(parseDailyCommand("is today's content ready?")).toEqual({ action: "status" });
  });
  it("takes a dictated caption verbatim", () => {
    const r = parseDailyCommand("Change the caption to: Your gym deserves a website that books members while you sleep.");
    expect(r).toMatchObject({ action: "caption", caption: "Your gym deserves a website that books members while you sleep." });
  });
  it("ignores unrelated talk", () => {
    expect(parseDailyCommand("what's the weather in Bengaluru")).toBeNull();
    expect(parseDailyCommand("create a reel about cafes")).toBeNull();
  });
});

const goodInput = (over: Partial<QcInput> = {}): QcInput => ({
  topic: "Why cafes lose evening orders without online ordering",
  hook: "Your café closes at 10. Hungry customers don't.",
  caption: "Late-night cravings happen after your shutters come down. When customers can't order online, they order from someone else.\n\nInfinity Web & Apps builds online ordering for cafes — a simple menu page, WhatsApp-ready order alerts and pickup slots — so evening orders keep coming in.\n\nWant it for your café? Call 8317480583.",
  cta: "Call 8317480583 for online ordering",
  hashtags: ["#cafe", "#onlineordering", "#smallbusiness", "#InfinityWebApps"],
  beats: ["Customers crave after closing time", "Online ordering keeps orders coming"],
  creativeConcept: "A cafe counter at night with a phone showing an online ordering menu glowing.",
  videoConcept: "Cafe closing, a customer searching to order, then the online ordering page, CTA.",
  postingTime: "19:00",
  image: { url: "https://x/api/ev/media/a", bytes: 90_000, width: 1024, height: 1280 },
  video: { url: "https://x/api/ev/media/b?kind=video", bytes: 900_000, mimeType: "video/mp4", seconds: 12, width: 1080, height: 1920 },
  history: [],
  publicUrl: true,
  ...over,
});

describe("quality check", () => {
  it("passes a complete, honest package", () => {
    const r = qualityCheck(goodInput());
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.passed).toBe(true);
    expect(r.checks.map((c) => c.key)).toEqual(expect.arrayContaining(["media", "caption", "match", "playable", "unique", "brand", "positioning", "placeholder", "claims", "instagram", "publishing"]));
  });
  it("fails missing media and an unplayable video", () => {
    expect(qualityCheck(goodInput({ image: null })).passed).toBe(false);
    const r = qualityCheck(goodInput({ video: { url: "u", bytes: 50_000, mimeType: "video/mp4", seconds: 0, width: 0, height: 0 } }));
    expect(r.checks.find((c) => c.key === "playable")!.ok).toBe(false);
    const wide = qualityCheck(goodInput({ video: { url: "u", bytes: 50_000, mimeType: "video/mp4", seconds: 12, width: 1920, height: 1080 } }));
    expect(wide.checks.find((c) => c.key === "playable")!.detail).toMatch(/9:16/);
  });
  it("catches fake claims, wrong brand, placeholders and repeats", () => {
    expect(findFakeClaims("We boost sales by 300% — guaranteed!")).toEqual(expect.arrayContaining(["300%", "guaranteed"]));
    expect(findFakeClaims("Websites from ₹4,999 and apps from ₹55,000")).toEqual([]);
    expect(findFakeClaims("Websites from ₹2,999")).toEqual(["₹2,999"]);
    expect(findFakeClaims("owners, 2024 was hard")).toEqual([]);
    expect(brandIssues("Infinity Web and Apps builds sites")).toEqual(["Infinity Web and Apps"]);
    expect(brandIssues("Infinity Web & Apps · @infinitywebapps. #InfinityWebApps call 8317480583")).toEqual([]);
    expect(brandIssues("call 9999999999")).toEqual(["9999999999"]);
    expect(findPlaceholders("Visit [your website] today")).toBe("[your website]");
    const dup = qualityCheck(goodInput({ history: [{ id: "1", title: "old", text: goodInput().topic + "\n" + goodInput().hook + "\n" + goodInput().caption, hook: goodInput().hook }] }));
    expect(dup.checks.find((c) => c.key === "unique")!.ok).toBe(false);
  });
  it("treats a non-public APP_URL as a warning, not a failure", () => {
    const r = qualityCheck(goodInput({ publicUrl: false }));
    expect(r.passed).toBe(true);
    expect(r.checks.find((c) => c.key === "public")).toMatchObject({ ok: false, severity: "warn" });
  });
});

describe("schedule", () => {
  it("plans the morning from 04:00 and shifts with the start", () => {
    expect(plannedTimes()).toEqual({ research: "04:00", content: "04:15", creative: "04:45", video: "05:00", qc: "05:20", ready: "05:30" });
    expect(plannedTimes("03:30").ready).toBe("05:00");
    expect(hm("05:30")).toBe(330);
    expect(clockLabel("05:30")).toBe("5:30 AM");
    expect(clockLabel("19:00")).toBe("7:00 PM");
  });
  it("marks late steps honestly and never marks unfinished work done", () => {
    const base = { status: "generating", stage: "video_wait", trigger: "schedule", log: [], hasCaption: true, hasImage: true, hasVideo: false, qcPassed: false, error: null };
    const s = stepStates(base, { nowMin: hm("05:10"), isToday: true });
    expect(s.find((x) => x.key === "creative")!.state).toBe("done");
    expect(s.find((x) => x.key === "video")).toMatchObject({ state: "active", late: true });
    expect(s.find((x) => x.key === "qc")).toMatchObject({ state: "pending", late: false });
    // a revision you asked for at noon isn't "late"
    expect(stepStates({ ...base, trigger: "video" }, { nowMin: hm("12:00"), isToday: true }).some((x) => x.late)).toBe(false);
    // failed shows on the step that failed
    expect(stepStates({ ...base, status: "failed" }, { nowMin: 0, isToday: true }).find((x) => x.key === "video")!.state).toBe("failed");
  });
  it("maps stages to the five streams", () => {
    expect(activeStream({ status: "generating", stage: "plan" })).toBe("IDEA");
    expect(activeStream({ status: "generating", stage: "image" })).toBe("CREATION");
    expect(activeStream({ status: "generating", stage: "video_wait" })).toBe("VIDEO");
    expect(activeStream({ status: "ready", stage: "ready" })).toBe("READY");
    expect(activeStream({ status: "approved", stage: "publishing" })).toBe("APPROVAL");
  });
  it("starts at 04:00 in Asia/Kolkata", () => {
    expect(autostartDue(new Date("2026-09-27T22:29:00Z"), "Asia/Kolkata")).toBe(false); // 03:59 IST
    expect(autostartDue(new Date("2026-09-27T22:31:00Z"), "Asia/Kolkata")).toBe(true);
    expect(localClock(new Date("2026-09-27T22:31:00Z"), "Asia/Kolkata")).toEqual({ date: "2026-09-28", minutes: 241 });
  });
});

describe("planning", () => {
  const prior = (niche: string, service: string, format: string): PriorPackage => ({ date: "2026-09-01", niche, service, format, topic: "t", hook: null, caption: null, creativeConcept: null, videoConcept: null, status: "published" });
  it("rotates niche, service and format away from recent packages", () => {
    const c = chooseAngle([prior("gyms", "Business websites", "Problem → solution")]);
    expect(c.niche).not.toBe("gyms");
    expect(c.service).not.toBe("Business websites");
    expect(c.format).not.toBe("Problem → solution");
    expect(leastRecent(["a", "b", "c"], ["a", "c", "b"])).toBe("b");
    expect(leastRecent(["a", "b"], [], ["a"])).toBe("b");
  });
  it("parses the model's JSON and cleans it", () => {
    const raw = "```json\n" + JSON.stringify({
      topic: "Why salons lose bookings at night", angle: "Clients book after hours.", contentType: "Reel + post",
      hook: "\"Your salon is closed. Your booking page isn't.\"", caption: "**Clients** decide at 11pm. " + "x".repeat(150) + " #salon #booking",
      cta: "Call 8317480583", hashtags: ["salon", "#Booking app", "#salon"], creativeConcept: "A salon chair at night with a glowing phone.",
      imagePrompt: "A premium salon interior at night with a phone showing a booking page", videoConcept: "Night, closed salon, phone books a slot, CTA.",
      beats: ["Clients book after closing", "Your page takes the booking", "extra"],
    }) + "\n```";
    const p = parsePlan(raw);
    expect(p.hook).toBe("Your salon is closed. Your booking page isn't.");
    expect(p.caption).not.toMatch(/#salon|\*\*/);
    expect(p.hashtags).toEqual(["#salon", "#Bookingapp"]);
    expect(p.beats).toHaveLength(2);
    expect(() => parsePlan("no json here")).toThrow(/JSON/);
    expect(() => parsePlan(JSON.stringify({ topic: "x" }))).toThrow(/incomplete/);
  });
  it("helpers", () => {
    expect(extractJson('noise {"a": "b } c", "n": {"x": 1}} tail')).toEqual({ a: "b } c", n: { x: 1 } });
    expect(cleanHashtags(["#a1", "a1", "#b-c", "#"])).toEqual(["#a1", "#bc"]);
    expect(cleanCaption("Hi #tag there\n\n\n\nBye")).toBe("Hi there\n\nBye");
    expect(parseRevision("video", JSON.stringify({ videoConcept: "A brand new story for the reel here.", beats: ["One line", "Two line"] })).beats).toEqual(["One line", "Two line"]);
    expect(() => parseRevision("caption", JSON.stringify({ hook: "only a hook here" }))).toThrow();
  });
});

describe("briefing + spoken status", () => {
  it("says only what the package row supports", () => {
    expect(evTodaySentence({ status: "ready", topic: "Cafe ordering", hasVideo: true, error: null, publishError: null }))
      .toMatch(/generated today's Instagram content — "Cafe ordering", created the promotional video, and prepared the publishing package\. The content is ready for your approval\./);
    expect(evTodaySentence({ status: "ready", topic: "", hasVideo: false, error: null, publishError: null })).not.toMatch(/video/);
    expect(evTodaySentence({ status: "generating", topic: "", hasVideo: false, error: null, publishError: null })).toMatch(/still preparing/);
    expect(evTodaySentence({ status: "failed", topic: "", hasVideo: false, error: "No key", publishError: null })).toMatch(/couldn't finish.*No key/);
    expect(evTodaySentence(null)).toBeNull();
  });
  it("EV's spoken status tells the truth", () => {
    const v = { enabled: true, started: true, startLabel: "4:00 AM", readyByLabel: "5:30 AM", pkg: null } as unknown as DailyView;
    expect(spokenStatus(v)).toMatch(/hasn't started/);
    expect(spokenStatus({ ...v, pkg: { status: "ready" } } as unknown as DailyView)).toBe("Today's content is ready. Would you like me to publish it?");
    expect(spokenStatus({ ...v, pkg: { status: "generating", stage: "video_wait", steps: [{ state: "active", label: "Video", late: true }] } } as unknown as DailyView)).toMatch(/video is still rendering, and it's running later than planned/);
  });
});

describe("reel", () => {
  it("lays out hook → beats → end card", () => {
    const t = reelTimeline(12, 2);
    expect(t.total).toBe(12);
    expect(t.hook.from).toBe(0);
    expect(t.beats).toHaveLength(2);
    expect(t.beats[1].to).toBeCloseTo(t.end.from);
    expect(t.end.to).toBe(12);
    expect(reelTimeline(100, 5).total).toBe(20);
  });
  it("probeMp4 rejects garbage", () => {
    expect(probeMp4(Buffer.from("not an mp4 at all"))).toBeNull();
  });
  const hasFfmpeg = existsSync(path.join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg"));
  it.skipIf(!hasFfmpeg)("renders a real, playable 9:16 MP4 from an image", async () => {
    const img = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 20, g: 30, b: 90 } } }).png().toBuffer();
    const r = await renderReel({ base: { kind: "image", bytes: img }, hook: "Customers search before they visit", beats: ["Be the one they find"], cta: "Call today", seconds: 8, variant: 1 });
    const probe = probeMp4(r.bytes)!;
    expect(probe.width).toBe(1080);
    expect(probe.height).toBe(1920);
    expect(probe.seconds).toBeGreaterThan(7.5);
    expect(probe.seconds).toBeLessThan(8.5);
  }, 120_000);
});
