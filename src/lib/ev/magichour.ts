import "server-only";
import { env } from "@/lib/env";

/**
 * Magic Hour AI client — EV's image + video generator (api.magichour.ai).
 *
 * Jobs are async: create returns a project id, then GET the image/video project
 * until it's complete and read the download URL. Nothing here waits longer than
 * the caller's budget, so it stays inside serverless limits (callers re-check).
 *
 * Request shapes follow Magic Hour's current API (the official SDK's types):
 * `aspect_ratio` ("1:1" | "9:16" | "16:9"), `end_seconds`, `style.prompt`, and
 * for image-to-video `assets.image_file_path` — either a public URL or a file
 * EV uploads first through /v1/files/upload-urls (so it also works when the app
 * runs on your own PC with no public address).
 */

export class MagicHourError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "MagicHourError";
  }
}

export type Aspect = "square" | "portrait" | "landscape";

function assertConfigured(): { base: string; key: string } {
  const key = env.magicHourApiKey;
  const base = env.magicHourBaseUrl.replace(/\/$/, "");
  if (!key) {
    throw new MagicHourError(
      "Magic Hour isn't connected. Add MAGICHOUR_API_KEY (magichour.ai → Developer → API key) so EV can generate images and videos.",
    );
  }
  return { base, key };
}

function headers(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/** Magic Hour's error body → one readable sentence. */
function errorMessage(status: number, json: any): string {
  if (status === 401 || status === 403) return "Magic Hour rejected the API key — check MAGICHOUR_API_KEY (magichour.ai → Developer).";
  if (status === 402) return "Magic Hour: not enough credits for this generation — top up at magichour.ai.";
  const m = json?.message || json?.error?.message || json?.error || json?.detail;
  const text = typeof m === "string" ? m : Array.isArray(m) ? m.map((x) => x?.msg ?? x?.message ?? String(x)).join("; ") : "";
  if (status === 429) return `Magic Hour is busy (rate-limited)${text ? `: ${text}` : ""} — try again in a minute.`;
  return text ? `Magic Hour: ${text}` : `Magic Hour API error (HTTP ${status}).`;
}

async function post(path: string, body: unknown): Promise<any> {
  const { base, key } = assertConfigured();
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new MagicHourError(errorMessage(res.status, json), res.status);
  return json;
}

async function getProject(kind: "image" | "video", id: string): Promise<any> {
  const { base, key } = assertConfigured();
  const path = kind === "image" ? `/v1/image-projects/${encodeURIComponent(id)}` : `/v1/video-projects/${encodeURIComponent(id)}`;
  const res = await fetch(`${base}${path}`, { headers: headers(key), signal: AbortSignal.timeout(20_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new MagicHourError(errorMessage(res.status, json), res.status);
  return json;
}

export interface MagicHourResult {
  status: string; // complete | error | canceled | queued | rendering | draft
  done: boolean;
  ok: boolean;
  url: string | null;
  projectId: string;
  kind: "image" | "video";
  /** Magic Hour's own reason when a render failed. */
  error?: string;
}

export function extractUrl(project: any): string | null {
  const dl = project?.downloads;
  if (Array.isArray(dl) && dl.length && dl[0]?.url) return dl[0].url;
  if (project?.download?.url) return project.download.url;
  return null;
}

/** Poll a project until it finishes or the time budget runs out. */
export async function waitProject(kind: "image" | "video", id: string, budgetMs: number, pollMs = 4000): Promise<MagicHourResult> {
  const deadline = Date.now() + budgetMs;
  let project = await getProject(kind, id);
  while (true) {
    const status = String(project?.status ?? "").toLowerCase();
    if (["complete", "error", "canceled"].includes(status)) {
      const ok = status === "complete";
      const url = ok ? extractUrl(project) : null;
      const error = !ok ? String(project?.error?.message || project?.error?.code || status) : undefined;
      return { status, done: true, ok: ok && !!url, url, projectId: id, kind, ...(error ? { error } : {}) };
    }
    if (Date.now() + pollMs >= deadline) {
      return { status: status || "rendering", done: false, ok: false, url: null, projectId: id, kind };
    }
    await new Promise((r) => setTimeout(r, pollMs));
    project = await getProject(kind, id);
  }
}

export function isConfigured(): boolean {
  return env.magicHourApiKey.length > 0;
}

/** EV's aspect → Magic Hour's aspect_ratio. */
export function aspectRatio(aspect: Aspect): "1:1" | "9:16" | "16:9" {
  return aspect === "portrait" ? "9:16" : aspect === "landscape" ? "16:9" : "1:1";
}

/** Start an AI image generation. Returns the project id. */
export async function createImage(prompt: string, aspect: Aspect = "square"): Promise<string> {
  const json = await post("/v1/ai-image-generator", {
    name: "EV image",
    image_count: 1,
    aspect_ratio: aspectRatio(aspect),
    ...(env.magicHourImageModel ? { model: env.magicHourImageModel } : {}),
    ...(env.magicHourImageResolution ? { resolution: env.magicHourImageResolution } : {}),
    style: { prompt: prompt.slice(0, 4000) },
  });
  const id = json?.id;
  if (!id) throw new MagicHourError("Magic Hour did not return a project id for the image.");
  return String(id);
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg", "image/webp": "webp", "image/heic": "heic" };

/**
 * Upload an image's bytes to Magic Hour's storage and return its file path —
 * usable as `image_file_path` without any public URL on our side.
 */
export async function uploadImage(bytes: Buffer, mimeType: string): Promise<string> {
  const extension = EXT[mimeType.toLowerCase()] ?? "png";
  const json = await post("/v1/files/upload-urls", { items: [{ type: "image", extension }] });
  const item = Array.isArray(json?.items) ? json.items[0] : null;
  if (!item?.upload_url || !item?.file_path) throw new MagicHourError("Magic Hour didn't return an upload address for the image.");
  const res = await fetch(item.upload_url, { method: "PUT", body: new Uint8Array(bytes), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new MagicHourError(`Uploading the image to Magic Hour failed (HTTP ${res.status}).`, res.status);
  return String(item.file_path);
}

/** Clip length Magic Hour's default models accept (3–15 s); a chosen model may allow more. */
export function videoSeconds(seconds: number | undefined): number {
  const max = env.magicHourVideoModel ? 60 : 15;
  return Math.round(Math.min(Math.max(seconds ?? 5, 3), max));
}

/**
 * Start a video generation. With a start image (a public URL, or bytes that are
 * uploaded first) → image-to-video; otherwise text-to-video. Returns the project id.
 */
export async function createVideo(opts: {
  prompt: string;
  imageUrl?: string;
  image?: { bytes: Buffer; mimeType: string };
  seconds?: number;
  aspect?: Aspect;
}): Promise<string> {
  const end_seconds = videoSeconds(opts.seconds);
  const common = {
    name: "EV video",
    end_seconds,
    ...(env.magicHourVideoModel ? { model: env.magicHourVideoModel } : {}),
    ...(env.magicHourVideoResolution ? { resolution: env.magicHourVideoResolution } : {}),
  };
  let json: any;
  const start = opts.image ? await uploadImage(opts.image.bytes, opts.image.mimeType) : opts.imageUrl;
  if (start) {
    json = await post("/v1/image-to-video", {
      ...common,
      assets: { image_file_path: start },
      style: { prompt: opts.prompt.slice(0, 4000) },
    });
  } else {
    json = await post("/v1/text-to-video", {
      ...common,
      aspect_ratio: aspectRatio(opts.aspect ?? "landscape"),
      style: { prompt: opts.prompt.slice(0, 4000) },
    });
  }
  const id = json?.id;
  if (!id) throw new MagicHourError("Magic Hour did not return a project id for the video.");
  return String(id);
}
