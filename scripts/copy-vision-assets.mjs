// Copies MediaPipe's WebAssembly runtime into public/vision so hand tracking is
// served from this app (camera frames never leave the device). Runs on install.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const src = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
const dest = path.join(process.cwd(), "public", "vision");
if (!existsSync(src)) {
  console.log("[vision] @mediapipe/tasks-vision not installed — skipping");
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
for (const f of readdirSync(src)) {
  if (!/^vision_wasm_(internal|nosimd_internal)\.(js|wasm)$/.test(f)) continue;
  copyFileSync(path.join(src, f), path.join(dest, f));
}
console.log("[vision] hand-tracking runtime copied to public/vision");
