import "server-only";
import sharp from "sharp";
import type { EvDaily, Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { recordActivity } from "@/lib/activity/record";
import { agentConfigs } from "@/lib/ai/agent";
import { completeWithFallback } from "@/lib/ai/complete";
import { generateImage, resolveImageProvider } from "@/lib/ev/image";
import * as magicHour from "@/lib/ev/magichour";
import { storeRemoteMedia } from "@/lib/ev/media";
import { itemText } from "@/lib/ev/memory";
import { fingerprint, findSimilar } from "@/lib/ev/dedup";
import { resolveIgCreds, igPublishImage, igCreateReel, igWaitContainer, igPublishContainer, IgError } from "@/lib/ev/instagram";
import { prepareImageForInstagram, IgImageError } from "@/lib/ev/igready";
import { renderReel, probeMp4, ReelError } from "./reel";
import { qualityCheck, type QcResult } from "./qc";
import {
  chooseAngle, imagePromptFor, parsePlan, parseRevision, planSystemPrompt, planUserPrompt, revisionPrompt,
  type PriorPackage, type RevisionKind,
} from "./plan";
import { autostartDue, clockLabel, localClock, type DailyLogEntry } from "./schedule";
import { asLog, packageView, type DailyView } from "./view";

/**
 * EV's daily content pipeline — a persistent, resumable state machine. Each
 * tick (Vercel Cron in the morning, `npm run local` every few minutes, and EV's
 * screen while it's open) advances the day's package as far as it can in its
 * time budget; slow work (Magic Hour renders, Instagram processing) is picked up
 * again on the next tick. Every step writes what really happened to the log.
 * Nothing is published without approval (unless EV_DAILY_AUTOPUBLISH is on).
 */

export class DailyError extends Error {
  constructor(message: string, public permanent = false) { super(message); }
}

/** Injected for tests; defaults are the real providers. */
export interface DailyDeps {
  now: () => Date;
  write: (system: string, user: string) => Promise<string>;
  image: (prompt: string) => Promise<{ bytes: Buffer; mimeType: string; provider: string }>;
  reel: typeof renderReel;
  magicHour: null | {
    createImage: (prompt: string) => Promise<string>;
    createVideo: (o: { prompt: string; image: { bytes: Buffer; mimeType: string } }) => Promise<string>;
    wait: (kind: "image" | "video", id: string, budgetMs: number) => Promise<{ done: boolean; ok: boolean; url: string | null; status: string; error?: string }>;
  };
  /**
   * Who makes the images and video: "magichour" = Magic Hour only (EV says so
   * when it isn't connected); "auto" (the default when omitted) = Magic Hour
   * first, the Gemini/OpenAI image model as the backup.
   */
  mediaMode?: "magichour" | "auto";
  /** Whether Instagram can fetch our media (public https APP_URL). */
  publicUrl: boolean;
}

/** EV's text providers, or why there are none (never throws). */
function evWriters(): { configs: ReturnType<typeof agentConfigs>["configs"]; missing?: string } {
  try { return agentConfigs("ev", null); } catch { return { configs: [], missing: "EV's writing brain isn't set up. Add GROQ_API_KEY or GEMINI_API_KEY (both free) to your environment, then say retry." }; }
}

export const isPublicUrl = (u: string) => /^https:\/\//i.test(u) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(u);

export function defaultDeps(): DailyDeps {
  return {
    now: () => new Date(),
    write: async (system, user) => {
      const { configs, missing } = evWriters();
      if (!configs.length) throw new DailyError(missing ?? "EV's writing brain isn't configured.", true);
      return completeWithFallback(configs, system, user, { maxTokens: 2200, timeoutMs: 60_000 });
    },
    image: async (prompt) => {
      if (!resolveImageProvider()) throw new DailyError("Image generation isn't configured. Connect Magic Hour (MAGICHOUR_API_KEY), or set GEMINI_API_KEY / OPENAI_API_KEY with EV_MEDIA_PROVIDER=auto.", true);
      const r = await generateImage(prompt, "portrait");
      return { bytes: r.bytes, mimeType: r.mimeType, provider: `${r.provider} · ${r.model}` };
    },
    reel: renderReel,
    magicHour: magicHour.isConfigured() ? {
      createImage: (prompt) => magicHour.createImage(prompt, "portrait"),
      createVideo: (o) => magicHour.createVideo({ prompt: o.prompt, image: o.image, seconds: 8, aspect: "portrait" }),
      wait: (kind, id, budgetMs) => magicHour.waitProject(kind, id, budgetMs),
    } : null,
    publicUrl: isPublicUrl(env.appUrl),
    mediaMode: env.evMediaProvider,
  };
}

const NO_MAGIC_HOUR = "EV makes the daily image and Reel with Magic Hour, and it isn't connected yet. Add MAGICHOUR_API_KEY (magichour.ai → Developer → API key) to your environment, restart / redeploy, then say retry.";

export function dailyConfig() {
  return {
    enabled: env.evDaily,
    tz: env.evDailyTz,
    start: env.evDailyStart,
    readyBy: env.evDailyReadyBy,
    postTime: env.evDailyPostTime,
    autoPublish: env.evDailyAutoPublish,
    video: env.evDailyVideo,
  };
}

const mediaUrl = (id: string, video = false) => `${env.appUrl.replace(/\/$/, "")}/api/ev/media/${id}${video ? "?kind=video" : ""}`;

/* ---------------- package rows ---------------- */

export async function currentPackage(userId: string, date: string) {
  return getDb().evDaily.findFirst({ where: { userId, date, current: true }, orderBy: { version: "desc" } });
}

/** Create today's first version if there isn't one (safe against a concurrent create). */
export async function ensurePackage(userId: string, date: string, trigger: "schedule" | "manual"): Promise<EvDaily> {
  const existing = await currentPackage(userId, date);
  if (existing) return existing;
  try {
    return await getDb().evDaily.create({
      data: { userId, date, version: 1, status: "generating", stage: "plan", trigger, postingTime: dailyConfig().postTime, log: [] },
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      const again = await currentPackage(userId, date);
      if (again) return again;
    }
    throw e;
  }
}

function entry(now: Date, step: string, text: string, ok = true): DailyLogEntry {
  return { at: now.toISOString(), step, text: text.slice(0, 400), ok };
}

async function save(id: string, data: Prisma.EvDailyUncheckedUpdateInput, log?: DailyLogEntry[]) {
  return getDb().evDaily.update({ where: { id }, data: log ? { ...data, log: log.slice(-60) as unknown as Prisma.InputJsonValue } : data });
}

/* ---------------- history (anti-repetition) ---------------- */

async function history(userId: string, excludeIds: string[]): Promise<PriorPackage[]> {
  const rows = await getDb().evDaily.findMany({
    where: { userId, id: { notIn: excludeIds }, topic: { not: "" } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { date: true, niche: true, service: true, format: true, topic: true, hook: true, caption: true, creativeConcept: true, videoConcept: true, status: true },
  });
  return rows;
}

async function evMemory(userId: string) {
  return getDb().evContent.findMany({
    where: { userId, kind: { notIn: ["note", "outreach"] } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, title: true, caption: true, hook: true, cta: true, body: true, theme: true, metadata: true },
  });
}

/** Everything a new idea must not repeat: other packages + EV's memory (minus this lineage's mirror rows). */
async function priorTexts(userId: string, excludeIds: string[], excludeContentIds: string[]) {
  const [pkgs, mem] = await Promise.all([
    getDb().evDaily.findMany({
      where: { userId, id: { notIn: excludeIds }, topic: { not: "" } },
      orderBy: { createdAt: "desc" }, take: 60,
      select: { id: true, topic: true, hook: true, caption: true, contentId: true },
    }),
    evMemory(userId),
  ]);
  const skip = new Set([...excludeContentIds, ...pkgs.map((p) => p.contentId).filter(Boolean) as string[]]);
  return [
    ...pkgs.map((p) => ({ id: p.id, title: p.topic, text: [p.topic, p.hook, p.caption].filter(Boolean).join("\n"), hook: p.hook })),
    ...mem.filter((m) => !skip.has(m.id)).map((m) => ({ id: m.id, title: m.title || (m.hook ?? "").slice(0, 60) || "EV item", text: itemText(m), hook: m.hook })),
  ];
}

/** Ids of every version in this date's lineage (so a revision isn't a "duplicate" of itself). */
async function lineage(userId: string, date: string) {
  const rows = await getDb().evDaily.findMany({ where: { userId, date }, select: { id: true, contentId: true, status: true } });
  return rows;
}

/* ---------------- steps ---------------- */

type StepResult = "advanced" | "waiting" | "done";

async function stepPlan(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[]): Promise<StepResult> {
  const now = deps.now();
  const siblings = await lineage(p.userId, p.date);
  const past = await history(p.userId, siblings.map((s) => s.id));
  const turnedDown = p.version > 1
    ? await getDb().evDaily.findFirst({ where: { userId: p.userId, date: p.date, version: p.version - 1 } })
    : null;
  const avoid = turnedDown && ["reject", "another", "regenerate"].includes(p.trigger)
    ? { niche: [turnedDown.niche ?? ""], service: [turnedDown.service ?? ""], format: [turnedDown.format ?? ""] }
    : {};
  // Rejected versions of today count as history too — the new one must differ from them.
  const todaysOld = await getDb().evDaily.findMany({ where: { userId: p.userId, date: p.date, id: { not: p.id }, topic: { not: "" } }, orderBy: { version: "desc" } });
  const allPast: PriorPackage[] = [...todaysOld.map((t) => ({ date: t.date, niche: t.niche, service: t.service, format: t.format, topic: t.topic, hook: t.hook, caption: t.caption, creativeConcept: t.creativeConcept, videoConcept: t.videoConcept, status: t.status })), ...past];
  const choice = chooseAngle(allPast, avoid);
  const priors = await priorTexts(p.userId, [p.id], siblings.filter((s) => s.id === p.id).map((s) => s.contentId ?? ""));
  log.push(entry(now, "research", `Reviewed ${allPast.length} past package${allPast.length === 1 ? "" : "s"} and ${priors.length} pieces in EV's memory — chose ${choice.niche} · ${choice.service} · ${choice.format}.`));

  let instruction = p.instruction;
  for (let attempt = 1; ; attempt++) {
    const text = await deps.write(planSystemPrompt(), planUserPrompt({ date: p.date, choice, history: allPast, instruction, rejected: turnedDown && p.trigger !== "manual" ? { ...turnedDown, format: turnedDown.format } : null }));
    const plan = parsePlan(text);
    const similar = [
      ...findSimilar([plan.topic, plan.hook, plan.caption].join("\n"), priors, 0.6),
      ...findSimilar(plan.topic, allPast.map((h, i) => ({ id: String(i), title: h.topic, text: h.topic })), 0.7),
      ...findSimilar(plan.hook, allPast.filter((h) => h.hook).map((h, i) => ({ id: String(i), title: h.topic, text: h.hook! })), 0.7),
    ];
    if (similar.length && attempt < 3) {
      log.push(entry(deps.now(), "content", `Draft "${plan.topic}" was too close to "${similar[0].title}" — rewriting.`, false));
      instruction = `${p.instruction ? p.instruction + ". " : ""}Your last draft ("${plan.topic}") repeated earlier content ("${similar[0].title}"). Pick a completely different topic and hook.`;
      continue;
    }
    log.push(entry(deps.now(), "content", `Wrote the post: "${plan.topic}" — hook, ${plan.caption.length}-character caption, ${plan.hashtags.length} hashtags.`));
    await save(p.id, {
      niche: choice.niche, service: choice.service, format: choice.format,
      topic: plan.topic, angle: plan.angle, contentType: plan.contentType.slice(0, 60),
      hook: plan.hook, caption: plan.caption, cta: plan.cta, hashtags: plan.hashtags, beats: plan.beats,
      creativeConcept: plan.creativeConcept, videoConcept: plan.videoConcept, imagePrompt: imagePromptFor(plan),
      stage: "image", error: null,
    }, log);
    await recordActivity(p.userId, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: `Wrote the ${p.date} Instagram post: ${plan.topic}`, status: "success", importance: 2 });
    return "advanced";
  }
}

async function stepRewrite(p: EvDaily, kind: RevisionKind, deps: DailyDeps, log: DailyLogEntry[]): Promise<StepResult> {
  const cur = { topic: p.topic, hook: p.hook ?? "", caption: p.caption ?? "", cta: p.cta ?? "", hashtags: p.hashtags, beats: p.beats, videoConcept: p.videoConcept ?? "", creativeConcept: p.creativeConcept ?? "" };
  const text = await deps.write(planSystemPrompt(), revisionPrompt(kind, cur, p.instruction ?? (kind === "video" ? "Make a different video" : "Improve it")));
  const r = parseRevision(kind, text);
  // each revision only touches its own fields
  const allowed: Record<RevisionKind, (keyof typeof r)[]> = {
    caption: ["caption", "hashtags"],
    tone: ["hook", "caption", "cta", "beats", "hashtags"],
    video: ["videoConcept", "beats"],
  };
  const data: Prisma.EvDailyUncheckedUpdateInput = { error: null };
  for (const k of allowed[kind]) {
    const v = r[k];
    if (v && (!Array.isArray(v) || v.length)) (data as Record<string, unknown>)[k] = v;
  }
  const changesVideo = kind !== "caption";
  if (changesVideo) { data.videoUrl = null; data.videoMediaId = null; data.videoSeconds = null; data.stage = "video"; }
  else data.stage = "qc";
  data.qc = undefined;
  log.push(entry(deps.now(), "content", kind === "caption" ? "Rewrote the caption as you asked." : kind === "tone" ? `Rewrote the hook, caption and on-screen lines (${p.instruction ?? "new tone"}).` : "Wrote a new Reel story and on-screen lines."));
  await save(p.id, data, log);
  return "advanced";
}

async function stepImage(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[]): Promise<StepResult> {
  const prompt = p.imagePrompt ?? "";
  if (!prompt) throw new DailyError("There's no image brief to render.", true);
  const onlyMagicHour = deps.mediaMode === "magichour";
  if (onlyMagicHour && !deps.magicHour) throw new DailyError(NO_MAGIC_HOUR, true);
  // Magic Hour whenever it's connected; the direct image model only as the "auto" backup
  let direct = !deps.magicHour;
  if (deps.magicHour) {
    try {
      const id = await deps.magicHour.createImage(prompt);
      log.push(entry(deps.now(), "creative", "Magic Hour is rendering the post image."));
      await save(p.id, { jobId: id, stage: "image_wait", imageProvider: "magichour" }, log);
      return "advanced";
    } catch (e) {
      if (onlyMagicHour || !resolveImageProvider()) throw new DailyError(`Magic Hour couldn't start the image — ${(e as Error).message}`);
      log.push(entry(deps.now(), "creative", `Magic Hour couldn't start (${(e as Error).message}) — using the backup image model.`, false));
      direct = true;
    }
  }
  if (direct) {
    const img = await deps.image(prompt);
    const media = await getDb().evMedia.create({ data: { userId: p.userId, mimeType: img.mimeType, data: img.bytes, prompt: prompt.slice(0, 4000) }, select: { id: true } });
    log.push(entry(deps.now(), "creative", `Generated the post image (${img.provider}).`));
    await save(p.id, { imageMediaId: media.id, imageUrl: mediaUrl(media.id), imageProvider: img.provider, stage: "video", error: null }, log);
  }
  return "advanced";
}

async function stepImageWait(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[], budgetMs: number): Promise<StepResult> {
  const r = await deps.magicHour!.wait("image", p.jobId!, Math.min(budgetMs, 60_000));
  if (!r.done) return "waiting";
  if (!r.ok || !r.url) throw new DailyError(`Magic Hour couldn't render the image (${r.error ?? r.status}).`);
  const stored = await storeRemoteMedia(p.userId, r.url, "image", p.imagePrompt ?? "EV daily image");
  if (!stored.stored) throw new DailyError("The Magic Hour image couldn't be downloaded and stored.");
  log.push(entry(deps.now(), "creative", "Magic Hour finished the post image."));
  await save(p.id, { imageMediaId: stored.id, imageUrl: stored.url, jobId: null, stage: "video", error: null }, log);
  return "advanced";
}

async function mediaBytes(id: string | null): Promise<{ bytes: Buffer; mimeType: string } | null> {
  if (!id) return null;
  const m = await getDb().evMedia.findUnique({ where: { id }, select: { data: true, mimeType: true } });
  if (!m) return null;
  return { bytes: Buffer.isBuffer(m.data) ? m.data : Buffer.from(m.data as Uint8Array), mimeType: m.mimeType };
}

function wantsMagicHour(p: EvDaily, deps: DailyDeps): boolean {
  const mode = dailyConfig().video;
  // the image's bytes are uploaded to Magic Hour, so no public URL is needed
  if (!deps.magicHour || !p.imageMediaId) return false;
  return mode === "magichour" || mode === "auto";
}

async function renderAndStore(p: EvDaily, deps: DailyDeps, base: { kind: "image" | "video"; bytes: Buffer }) {
  const reel = await deps.reel({ base, hook: p.hook ?? "", beats: p.beats, cta: p.cta ?? "", seconds: 12, variant: p.variant });
  const media = await getDb().evMedia.create({ data: { userId: p.userId, mimeType: reel.mimeType, data: reel.bytes, prompt: `EV Reel · ${p.topic}`.slice(0, 4000), width: reel.width, height: reel.height }, select: { id: true } });
  return { id: media.id, url: mediaUrl(media.id, true), seconds: reel.seconds, size: reel.bytes.length };
}

async function stepVideo(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[]): Promise<StepResult> {
  if (!p.imageMediaId) throw new DailyError("The post image is missing, so there's nothing to animate.", true);
  // a revision that only changes text re-cuts the same Magic Hour clip
  if (p.videoBaseId && p.trigger !== "video") {
    const clip = await mediaBytes(p.videoBaseId);
    if (clip) {
      const out = await renderAndStore(p, deps, { kind: "video", bytes: clip.bytes });
      log.push(entry(deps.now(), "video", `Re-cut the Reel (${out.seconds}s, 9:16) with the new text.`));
      await save(p.id, { videoMediaId: out.id, videoUrl: out.url, videoSeconds: out.seconds, stage: "qc", error: null }, log);
      return "advanced";
    }
  }
  if (wantsMagicHour(p, deps)) {
    try {
      const start = await mediaBytes(p.imageMediaId);
      if (!start) throw new Error("the post image file couldn't be loaded");
      const id = await deps.magicHour!.createVideo({ prompt: `${p.videoConcept ?? p.topic}. Smooth cinematic camera motion, premium commercial look, vertical 9:16. No text on screen.`, image: start });
      log.push(entry(deps.now(), "video", "Magic Hour is animating the creative into a 9:16 clip."));
      await save(p.id, { jobId: id, stage: "video_wait", videoProvider: "magichour + EV Reel" }, log);
      return "advanced";
    } catch (e) {
      log.push(entry(deps.now(), "video", `Magic Hour couldn't start (${(e as Error).message}) — rendering the Reel from the image instead.`, false));
    }
  }
  const img = await mediaBytes(p.imageMediaId);
  if (!img) throw new DailyError("The post image file couldn't be loaded.", true);
  const out = await renderAndStore(p, deps, { kind: "image", bytes: img.bytes });
  log.push(entry(deps.now(), "video", `Rendered the promotional Reel — ${out.seconds}s, 1080×1920 MP4 (${(out.size / 1_048_576).toFixed(1)} MB).`));
  await save(p.id, { videoMediaId: out.id, videoUrl: out.url, videoSeconds: out.seconds, videoProvider: "EV Reel (motion)", stage: "qc", error: null }, log);
  await recordActivity(p.userId, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Created the promotional Reel for the daily post", result: `${out.seconds}s · 9:16 MP4`, status: "success", importance: 2 });
  return "advanced";
}

const MAGIC_HOUR_PATIENCE_MS = 25 * 60_000;

async function stepVideoWait(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[], budgetMs: number): Promise<StepResult> {
  const startedAt = [...log].reverse().find((e) => e.step === "video" && /Magic Hour is animating/.test(e.text))?.at;
  const waited = startedAt ? deps.now().getTime() - Date.parse(startedAt) : 0;
  const r = deps.magicHour && p.jobId ? await deps.magicHour.wait("video", p.jobId, Math.min(budgetMs, 60_000)) : { done: true, ok: false, url: null, status: "not connected" };
  let clip: Buffer | null = null;
  if (r.done && r.ok && r.url) {
    const stored = await storeRemoteMedia(p.userId, r.url, "video", `Magic Hour clip · ${p.topic}`);
    const b = stored.stored ? await mediaBytes(stored.id) : null;
    if (b) { clip = b.bytes; await save(p.id, { videoBaseId: stored.id }); }
  }
  if (!r.done && waited < MAGIC_HOUR_PATIENCE_MS) return "waiting";
  const fresh = await getDb().evDaily.findUniqueOrThrow({ where: { id: p.id } });
  if (clip) {
    const out = await renderAndStore(fresh, deps, { kind: "video", bytes: clip });
    log.push(entry(deps.now(), "video", `Magic Hour clip ready — cut it into a ${out.seconds}s branded Reel with the hook and CTA.`));
    await save(p.id, { videoMediaId: out.id, videoUrl: out.url, videoSeconds: out.seconds, jobId: null, stage: "qc", error: null }, log);
  } else {
    const why = !r.done ? `still not finished after ${Math.round(waited / 60_000)} minutes` : r.ok ? "the clip couldn't be downloaded" : `render ${("error" in r && r.error) || r.status}`;
    const img = await mediaBytes(fresh.imageMediaId);
    if (!img) throw new DailyError("The post image file couldn't be loaded.", true);
    const out = await renderAndStore(fresh, deps, { kind: "image", bytes: img.bytes });
    log.push(entry(deps.now(), "video", `Magic Hour ${why} — rendered the ${out.seconds}s Reel from the image instead.`, true));
    await save(p.id, { videoMediaId: out.id, videoUrl: out.url, videoSeconds: out.seconds, videoProvider: "EV Reel (motion)", jobId: null, stage: "qc", error: null }, log);
  }
  await recordActivity(p.userId, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Created the promotional Reel for the daily post", status: "success", importance: 2 });
  return "advanced";
}

async function stepQc(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[]): Promise<StepResult> {
  const [img, vid, siblings] = await Promise.all([mediaBytes(p.imageMediaId), mediaBytes(p.videoMediaId), lineage(p.userId, p.date)]);
  let imgMeta: { width: number; height: number } = { width: 0, height: 0 };
  if (img) { try { const m = await sharp(img.bytes).metadata(); imgMeta = { width: m.width ?? 0, height: m.height ?? 0 }; } catch { /* unreadable → fails the check */ } }
  const probe = vid ? probeMp4(vid.bytes) : null;
  // compare against everything except this date's revisions of the same idea
  const sameIdea = ["caption", "yours", "tone", "video", "retry"].includes(p.trigger);
  const exclude = sameIdea ? siblings.map((s) => s.id) : [p.id];
  const excludeContent = sameIdea ? siblings.map((s) => s.contentId ?? "").filter(Boolean) : [p.contentId ?? ""];
  const hist = await priorTexts(p.userId, exclude, excludeContent);
  const qc: QcResult = qualityCheck({
    topic: p.topic, hook: p.hook ?? "", caption: p.caption ?? "", cta: p.cta ?? "", hashtags: p.hashtags, beats: p.beats,
    creativeConcept: p.creativeConcept ?? "", videoConcept: p.videoConcept ?? "", postingTime: p.postingTime,
    image: img ? { url: p.imageUrl, bytes: img.bytes.length, ...imgMeta } : null,
    video: vid && probe ? { url: p.videoUrl, bytes: vid.bytes.length, mimeType: vid.mimeType, ...probe } : vid ? { url: p.videoUrl, bytes: vid.bytes.length, mimeType: vid.mimeType, seconds: 0, width: 0, height: 0 } : null,
    history: hist, publicUrl: deps.publicUrl,
  }, deps.now());
  const failed = qc.checks.filter((c) => !c.ok && c.severity === "error");
  if (!failed.length) {
    const now = deps.now();
    log.push(entry(now, "qc", `Quality check passed (${qc.checks.filter((c) => c.ok).length}/${qc.checks.length})${qc.checks.some((c) => !c.ok) ? " — note: " + qc.checks.filter((c) => !c.ok).map((c) => c.detail).join(" ") : ""}.`));
    log.push(entry(now, "ready", "Ready for your approval."));
    await save(p.id, { qc: qc as unknown as Prisma.InputJsonValue, status: "ready", stage: "ready", readyAt: now, error: null }, log);
    await mirror(p.id, "ready");
    await recordActivity(p.userId, {
      category: "marketing", agent: "EV", source: "ev", project: "EV", importance: 3, status: "success",
      action: `Prepared the ${p.date} Instagram content: ${p.topic}`,
      result: "Post image, promotional Reel, caption and hashtags are ready for approval",
    });
    return "done";
  }
  const textOnly = failed.every((c) => ["caption", "match", "brand", "placeholder", "claims", "instagram", "publishing", "positioning"].includes(c.key));
  const duplicate = failed.some((c) => c.key === "unique");
  const reasons = failed.map((c) => `${c.label}: ${c.detail}`).join(" · ");
  // your own words are never silently rewritten — say what's wrong instead
  if (p.trigger === "yours" && textOnly) {
    throw new DailyError(`Your caption didn't pass the quality check — ${reasons}. Give me another caption, or say "change the caption" and I'll write one.`, true);
  }
  if (p.attempts < 2 && (textOnly || duplicate)) {
    log.push(entry(deps.now(), "qc", `Quality check caught: ${reasons} — fixing it.`, false));
    await save(p.id, duplicate
      ? { qc: qc as unknown as Prisma.InputJsonValue, attempts: { increment: 1 }, stage: "plan", instruction: `Avoid repeating recent content. ${p.instruction ?? ""}`.trim(), imageMediaId: null, imageUrl: null, videoMediaId: null, videoUrl: null, videoBaseId: null }
      : { qc: qc as unknown as Prisma.InputJsonValue, attempts: { increment: 1 }, stage: "rewrite_tone", instruction: `Fix these problems and keep everything else: ${reasons}` }, log);
    return "advanced";
  }
  throw new DailyError(`Quality check failed — ${reasons}`, true);
}

/* ---------------- publishing ---------------- */

export function publishCaption(p: { caption: string | null; hashtags: string[] }) {
  return `${(p.caption ?? "").trim()}\n\n${p.hashtags.join(" ")}`.trim().slice(0, 2200);
}

async function stepPublish(p: EvDaily, deps: DailyDeps, log: DailyLogEntry[], budgetMs: number): Promise<StepResult> {
  const creds = await resolveIgCreds(p.userId);
  if (!creds) {
    await save(p.id, { publishError: "Instagram isn't connected. Add INSTAGRAM_ACCESS_TOKEN (and INSTAGRAM_BUSINESS_ID if it doesn't start with IG), then say publish again." });
    return "done";
  }
  if (!deps.publicUrl) {
    await save(p.id, { publishError: "APP_URL isn't a public https address, so Instagram can't fetch the media. Set APP_URL to your deployed URL." });
    return "done";
  }
  const caption = publishCaption(p);
  try {
    let { postMediaId, reelContainerId } = p;
    if (!postMediaId && p.imageUrl) {
      const ready = await prepareImageForInstagram(p.userId, p.imageUrl);
      postMediaId = await igPublishImage(creds, ready.url, caption);
      log.push(entry(deps.now(), "publish", `Post published to Instagram (media ${postMediaId}).`));
      await save(p.id, { postMediaId, publishError: null }, log);
      await recordActivity(p.userId, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Published the daily post to Instagram", result: p.topic, status: "success", importance: 4, metadata: { mediaId: postMediaId } });
    }
    if (p.videoUrl && !p.reelMediaId) {
      if (!reelContainerId) {
        reelContainerId = await igCreateReel(creds, p.videoUrl, caption);
        await save(p.id, { reelContainerId });
      }
      const st = await igWaitContainer(creds, reelContainerId, Math.min(budgetMs, 45_000));
      if (st.error) {
        await save(p.id, { reelContainerId: null, publishError: `Instagram couldn't process the Reel${st.detail ? `: ${st.detail}` : ""}.` });
        return "done";
      }
      if (!st.ready) return "waiting";
      const reelMediaId = await igPublishContainer(creds, reelContainerId);
      log.push(entry(deps.now(), "publish", `Reel published to Instagram (media ${reelMediaId}).`));
      await save(p.id, { reelMediaId, publishError: null }, log);
      await recordActivity(p.userId, { category: "marketing", agent: "EV", source: "ev", project: "EV", action: "Published the daily Reel to Instagram", result: p.topic, status: "success", importance: 4, metadata: { mediaId: reelMediaId } });
    }
    const now = deps.now();
    log.push(entry(now, "publish", "Today's content is live on Instagram."));
    const done = await save(p.id, { status: "published", stage: "done", publishedAt: now, publishError: null }, log);
    await mirror(p.id, "published", done.reelMediaId ?? done.postMediaId ?? undefined);
    return "done";
  } catch (e) {
    const msg = e instanceof IgError || e instanceof IgImageError ? e.message : (e as Error).message;
    log.push(entry(deps.now(), "publish", `Instagram: ${msg}`, false));
    await save(p.id, { publishError: `Instagram: ${msg}` }, log);
    await recordActivity(p.userId, { category: "error", agent: "EV", source: "ev", project: "EV", action: "Publishing the daily content failed", result: msg, status: "failed", importance: 4 });
    return "done";
  }
}

/** Keep EV's content memory (EvContent) in step, so the studio and EV's chat know about it. */
async function mirror(id: string, status: "ready" | "approved" | "published" | "rejected", externalId?: string) {
  const p = await getDb().evDaily.findUnique({ where: { id } });
  if (!p) return;
  const meta = { imageUrl: p.imageUrl, imageMediaId: p.imageMediaId, videoUrl: p.videoUrl, videoMediaId: p.videoMediaId, dailyId: p.id, hashtags: p.hashtags };
  const data = {
    status, niche: p.niche, theme: p.service, title: p.topic, caption: p.caption, hook: p.hook, cta: p.cta, body: p.videoConcept,
    metadata: meta as Prisma.InputJsonValue,
    ...(status === "published" ? { publishedAt: new Date(), externalId: externalId ?? null } : {}),
  };
  if (p.contentId) {
    await getDb().evContent.updateMany({ where: { id: p.contentId, userId: p.userId }, data }).catch(() => {});
    return;
  }
  const row = await getDb().evContent.create({
    data: { userId: p.userId, kind: "reel", fingerprint: fingerprint(itemText({ title: p.topic, hook: p.hook, caption: p.caption, cta: p.cta, body: p.videoConcept, theme: p.service })), ...data },
    select: { id: true },
  }).catch(() => null);
  if (row) await save(p.id, { contentId: row.id });
}

/* ---------------- the state machine ---------------- */

async function lease(id: string, now: Date, ms: number): Promise<boolean> {
  const r = await getDb().evDaily.updateMany({
    where: { id, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { lockedUntil: new Date(now.getTime() + ms) },
  });
  return r.count === 1;
}

const TRANSIENT_RETRIES = 3;

/**
 * Advance one package as far as possible within `budgetMs`. Returns the fresh
 * row. Concurrent callers (cron + screen) don't collide: only the lease holder
 * works; the others just read.
 */
export async function advance(id: string, opts: { budgetMs?: number; deps?: DailyDeps } = {}): Promise<EvDaily> {
  const deps = opts.deps ?? defaultDeps();
  const budget = opts.budgetMs ?? 240_000;
  const t0 = deps.now().getTime();
  if (!(await lease(id, deps.now(), budget + 90_000))) return getDb().evDaily.findUniqueOrThrow({ where: { id } });
  try {
    for (let guard = 0; guard < 14; guard++) {
      const p = await getDb().evDaily.findUniqueOrThrow({ where: { id } });
      const left = budget - (deps.now().getTime() - t0);
      if (left < 5_000) break;
      const busy = p.status === "generating" || (p.status === "approved" && p.stage === "publishing" && !p.publishError);
      const autoPub = p.status === "ready" && dailyConfig().autoPublish && postingDue(p, deps.now());
      if (!busy && !autoPub) break;
      if (autoPub) {
        await save(p.id, { status: "approved", stage: "publishing", approvedAt: deps.now() }, [...asLog(p.log), entry(deps.now(), "publish", `Auto-publish is on — publishing at the planned time (${clockLabel(p.postingTime ?? "")}).`)]);
        await mirror(p.id, "approved");
        continue;
      }
      const log = asLog(p.log);
      let r: StepResult;
      try {
        switch (p.stage) {
          case "plan": r = await stepPlan(p, deps, log); break;
          case "rewrite_caption": r = await stepRewrite(p, "caption", deps, log); break;
          case "rewrite_tone": r = await stepRewrite(p, "tone", deps, log); break;
          case "rewrite_video": r = await stepRewrite(p, "video", deps, log); break;
          case "image": r = await stepImage(p, deps, log); break;
          case "image_wait": r = await stepImageWait(p, deps, log, left); break;
          case "video": r = await stepVideo(p, deps, log); break;
          case "video_wait": r = await stepVideoWait(p, deps, log, left); break;
          case "qc": r = await stepQc(p, deps, log); break;
          case "publishing": r = await stepPublish(p, deps, log, left); break;
          default: r = "done";
        }
      } catch (e) {
        const permanent = e instanceof DailyError ? e.permanent : false;
        const msg = e instanceof ReelError || e instanceof DailyError ? e.message : (e as Error)?.message || String(e);
        const tries = p.attempts + 1;
        const give = permanent || tries >= TRANSIENT_RETRIES;
        log.push(entry(deps.now(), p.stage, `${stageLabel(p.stage)} failed: ${msg}${give ? "" : " — will retry."}`, false));
        await save(p.id, { error: msg, attempts: tries, ...(give ? { status: "failed" } : {}) }, log);
        if (give) {
          await recordActivity(p.userId, { category: "error", agent: "EV", source: "ev", project: "EV", action: `Daily content failed at the ${stageLabel(p.stage).toLowerCase()} step`, result: msg, status: "failed", importance: 3 });
        }
        break;
      }
      if (r === "waiting" || r === "done") break;
    }
  } finally {
    await getDb().evDaily.update({ where: { id }, data: { lockedUntil: null } }).catch(() => {});
  }
  return getDb().evDaily.findUniqueOrThrow({ where: { id } });
}

export function stageLabel(stage: string): string {
  return ({ plan: "Research & content", rewrite_caption: "Caption rewrite", rewrite_tone: "Rewrite", rewrite_video: "Video rewrite", image: "Creative", image_wait: "Creative", video: "Video", video_wait: "Video", qc: "Quality check", publishing: "Publishing" } as Record<string, string>)[stage] ?? stage;
}

function postingDue(p: EvDaily, now: Date): boolean {
  const c = localClock(now, dailyConfig().tz);
  const [h, m] = (p.postingTime ?? "99:99").split(":").map(Number);
  return c.date > p.date || (c.date === p.date && c.minutes >= h * 60 + m);
}

/* ---------------- actions ---------------- */

export type DailyActionInput =
  | { action: "generate" }
  | { action: "approve" }
  | { action: "retry" }
  | { action: "reject" | "regenerate" | "another"; instruction?: string }
  | { action: "caption"; instruction?: string; caption?: string }
  | { action: "tone"; instruction?: string; tone?: string }
  | { action: "video"; instruction?: string };

export interface ActionResult { pkg: EvDaily; message: string; advance: boolean }

async function newVersion(p: EvDaily, over: Prisma.EvDailyUncheckedCreateInput, note: string): Promise<EvDaily> {
  const db = getDb();
  const top = await db.evDaily.findFirst({ where: { userId: p.userId, date: p.date }, orderBy: { version: "desc" }, select: { version: true } });
  await db.evDaily.updateMany({ where: { userId: p.userId, date: p.date, current: true }, data: { current: false } });
  return db.evDaily.create({ data: { ...over, userId: p.userId, date: p.date, version: (top?.version ?? p.version) + 1, current: true, log: [entry(new Date(), "note", note)] as unknown as Prisma.InputJsonValue } });
}

/** Everything a revision keeps from the version it revises. */
function carry(p: EvDaily): Prisma.EvDailyUncheckedCreateInput {
  return {
    userId: p.userId, date: p.date, status: "generating", contentType: p.contentType, niche: p.niche, service: p.service, format: p.format,
    topic: p.topic, angle: p.angle, hook: p.hook, caption: p.caption, cta: p.cta, hashtags: p.hashtags, beats: p.beats,
    creativeConcept: p.creativeConcept, videoConcept: p.videoConcept, imagePrompt: p.imagePrompt,
    imageMediaId: p.imageMediaId, imageUrl: p.imageUrl, imageProvider: p.imageProvider,
    videoMediaId: p.videoMediaId, videoUrl: p.videoUrl, videoSeconds: p.videoSeconds, videoProvider: p.videoProvider, videoBaseId: p.videoBaseId,
    variant: p.variant, postingTime: p.postingTime,
  };
}

export async function applyAction(userId: string, date: string, a: DailyActionInput, deps: DailyDeps = defaultDeps()): Promise<ActionResult> {
  const p = await currentPackage(userId, date);
  if (a.action === "generate") {
    const pkg = p ?? await ensurePackage(userId, date, "manual");
    return { pkg, message: p ? "Today's content is already underway." : "Starting today's content now.", advance: true };
  }
  if (!p) throw new DailyError("There's no content for today yet.");
  const now = deps.now();

  switch (a.action) {
    case "approve": {
      if (p.status === "published") return { pkg: p, message: "It's already published.", advance: false };
      if (p.status === "approved") {
        const pkg = await save(p.id, { publishError: null, stage: "publishing" });
        return { pkg, message: "Trying the publish again.", advance: true };
      }
      if (p.status !== "ready") throw new DailyError(p.status === "generating" ? "It isn't ready yet — I'm still preparing it." : "There's nothing ready to approve.");
      const pkg = await save(p.id, { status: "approved", stage: "publishing", approvedAt: now, publishError: null }, [...asLog(p.log), entry(now, "publish", "Approved by you — publishing to Instagram.")]);
      await mirror(p.id, "approved");
      await recordActivity(userId, { category: "decision", agent: "EV", source: "ev", project: "EV", action: `Approved the ${p.date} Instagram content`, result: p.topic, status: "success", importance: 3 });
      return { pkg, message: "Approved. Publishing it to Instagram now.", advance: true };
    }
    case "retry": {
      if (p.status !== "failed" && !(p.status === "approved" && p.publishError)) return { pkg: p, message: "Nothing has failed — it's " + p.status + ".", advance: p.status === "generating" };
      const pkg = await save(p.id, p.status === "approved" ? { publishError: null, stage: "publishing" } : { status: "generating", error: null, attempts: 0 }, [...asLog(p.log), entry(now, "note", "Retrying as you asked.")]);
      return { pkg, message: "Retrying now.", advance: true };
    }
    case "reject": case "regenerate": case "another": {
      if (p.status === "published") throw new DailyError("Today's content is already published — I can't reject it now.");
      await save(p.id, { status: "rejected", rejectedAt: now, current: false });
      await mirror(p.id, "rejected");
      if (a.action === "reject") await recordActivity(userId, { category: "decision", agent: "EV", source: "ev", project: "EV", action: `Rejected the ${p.date} Instagram content`, result: p.topic, status: "info", importance: 2 });
      const pkg = await newVersion(p, { userId, date: p.date, status: "generating", stage: "plan", trigger: a.action, instruction: a.instruction ?? null, postingTime: p.postingTime }, a.action === "another" ? "You asked for another idea." : a.action === "reject" ? `Version ${p.version} rejected — making a new one.` : "Regenerating from scratch.");
      return { pkg, message: a.action === "another" ? "Working on a different idea now." : "Got it — creating a new version.", advance: true };
    }
    case "caption": case "tone": case "video": {
      if (p.status === "published") throw new DailyError("It's already published — I can't change it now.");
      if (!p.caption || !p.imageUrl) throw new DailyError("The first draft isn't finished yet — give me a moment, then ask again.");
      const base = carry(p);
      if (a.action === "caption" && a.caption) {
        const pkg = await newVersion(p, { ...base, caption: a.caption.slice(0, 2000), stage: "qc", trigger: "yours", instruction: a.instruction ?? null }, "Using your caption.");
        return { pkg, message: "Using your caption — checking it now.", advance: true };
      }
      const stage = a.action === "caption" ? "rewrite_caption" : a.action === "tone" ? "rewrite_tone" : "rewrite_video";
      const extra = a.action === "video" ? { variant: p.variant + 1, videoBaseId: null } : {};
      const pkg = await newVersion(p, { ...base, ...extra, stage, trigger: a.action, instruction: a.instruction ?? (a.action === "tone" ? `Make it ${"tone" in a && a.tone ? a.tone : "better"}` : null) }, a.action === "caption" ? "Rewriting the caption." : a.action === "video" ? "Making a new video." : `Reworking it: ${a.instruction ?? ""}`);
      return { pkg, message: a.action === "caption" ? "Rewriting the caption." : a.action === "video" ? "Making a new video — this takes a minute." : "Reworking the content now.", advance: true };
    }
  }
}

/* ---------------- read side ---------------- */

export async function dailyView(userId: string, deps: Pick<DailyDeps, "now" | "publicUrl"> = defaultDeps()): Promise<DailyView> {
  const cfg = dailyConfig();
  const now = deps.now();
  const today = localClock(now, cfg.tz).date;
  const [pkg, hist, ig] = await Promise.all([
    currentPackage(userId, today),
    getDb().evDaily.findMany({ where: { userId, current: true, date: { not: today } }, orderBy: { date: "desc" }, take: 10, select: { id: true, date: true, version: true, topic: true, status: true, niche: true, createdAt: true } }),
    resolveIgCreds(userId).catch(() => null),
  ]);
  const writer = evWriters().configs[0]?.provider ?? null;
  const image = magicHour.isConfigured() ? "magichour" : env.evMediaProvider === "auto" ? resolveImageProvider()?.provider ?? null : null;
  return {
    enabled: cfg.enabled, timezone: cfg.tz, today, start: cfg.start, readyBy: cfg.readyBy,
    startLabel: clockLabel(cfg.start), readyByLabel: clockLabel(cfg.readyBy), autoPublish: cfg.autoPublish,
    started: autostartDue(now, cfg.tz, cfg.start),
    pkg: pkg ? packageView(pkg, { now, tz: cfg.tz, start: cfg.start, readyBy: cfg.readyBy }) : null,
    history: hist.map((h) => ({ ...h, createdAt: h.createdAt.toISOString() })),
    capabilities: {
      writer, image,
      video: magicHour.isConfigured() && cfg.video !== "motion" ? "Magic Hour + EV Reel" : "EV Reel (motion render)",
      instagram: !!ig, publicUrl: deps.publicUrl,
    },
  };
}

/** Who gets a package automatically: anyone who has used EV. */
export async function dailyUsers(): Promise<string[]> {
  const db = getDb();
  const [a, b] = await Promise.all([
    db.evContent.findMany({ distinct: ["userId"], select: { userId: true } }),
    db.activityEvent.findMany({ where: { agent: "EV" }, distinct: ["userId"], select: { userId: true } }),
  ]);
  return [...new Set([...a, ...b].map((r) => r.userId))];
}

/**
 * The scheduled run: once it's past the start time, make sure today's package
 * exists and push every unfinished one forward.
 */
export async function runSchedule(opts: { budgetMs?: number; deps?: DailyDeps; userIds?: string[] } = {}) {
  const cfg = dailyConfig();
  const deps = opts.deps ?? defaultDeps();
  if (!cfg.enabled) return { skipped: "EV_DAILY is off", results: [] };
  const now = deps.now();
  const today = localClock(now, cfg.tz).date;
  const due = autostartDue(now, cfg.tz, cfg.start);
  const users = opts.userIds ?? await dailyUsers();
  const results: { userId: string; status: string; stage: string }[] = [];
  const per = Math.max(20_000, Math.floor((opts.budgetMs ?? 240_000) / Math.max(users.length, 1)));
  for (const userId of users) {
    let p = await currentPackage(userId, today);
    if (!p && due) p = await ensurePackage(userId, today, "schedule");
    if (!p) continue;
    if (p.status === "generating" || (p.status === "approved" && !p.publishError && p.stage === "publishing") || (p.status === "ready" && cfg.autoPublish)) {
      p = await advance(p.id, { budgetMs: per, deps });
    }
    results.push({ userId, status: p.status, stage: p.stage });
  }
  return { today, due, results };
}
