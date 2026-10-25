import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { requireUser } from "@/lib/auth/session";
import { fail, handleError } from "@/lib/api";
import { getDb } from "@/lib/db";
import { safeProjectFile } from "@/lib/friday/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream", ".stl": "model/stl", ".blend": "application/x-blender", ".json": "application/json",
};

/**
 * Friday's files: /api/friday/files/<projectId>/<version>/<path inside the version folder>.
 * Only the signed-in owner's projects, only inside that version's folder.
 * ?download=1 sends it as an attachment.
 */
export async function GET(req: Request, { params }: { params: { path: string[] } }) {
  try {
    const user = await requireUser();
    const [projectId, n, ...rest] = params.path ?? [];
    const version = Number(n);
    if (!projectId || !Number.isInteger(version) || version < 1 || !rest.length) return fail("Not found.", 404);
    const project = await getDb().fridayProject.findFirst({ where: { id: projectId, userId: user.id }, select: { dir: true, slug: true } });
    if (!project) return fail("Not found.", 404);
    const file = safeProjectFile(project, version, rest.map(decodeURIComponent).join("/"));
    if (!file) return fail("Not found.", 404);
    const ext = path.extname(file).toLowerCase();
    if (!TYPES[ext]) return fail("Not found.", 404);
    const fmt = new URL(req.url).searchParams.get("format");
    if (fmt === "jpeg" && ext === ".png") {
      // JPEG copy of a render, made from the verified PNG on request
      const jpg = await sharp(file).flatten({ background: "#000000" }).jpeg({ quality: 92 }).toBuffer();
      const h: Record<string, string> = { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" };
      if (new URL(req.url).searchParams.get("download") === "1") h["Content-Disposition"] = `attachment; filename="${project.slug}-v${String(version).padStart(3, "0")}-${path.basename(file, ".png")}.jpg"`;
      return new Response(new Uint8Array(jpg), { headers: h });
    }
    const body = await fs.readFile(file);
    const headers: Record<string, string> = { "Content-Type": TYPES[ext], "Cache-Control": ext === ".json" ? "no-store" : "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" };
    if (new URL(req.url).searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="${project.slug}-v${String(version).padStart(3, "0")}-${path.basename(file)}"`;
    return new Response(new Uint8Array(body), { headers });
  } catch (e) {
    return handleError(e);
  }
}
