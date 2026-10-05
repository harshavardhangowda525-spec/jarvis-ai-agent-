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

// Face recognition (JARVIS Face ID): detector, landmarks and the descriptor
// network from @vladmandic/face-api, served from public/models/face-api.
const faSrc = path.join(process.cwd(), "node_modules", "@vladmandic", "face-api", "model");
const faDest = path.join(process.cwd(), "public", "models", "face-api");
if (existsSync(faSrc)) {
  mkdirSync(faDest, { recursive: true });
  for (const f of readdirSync(faSrc)) {
    if (!/^(tiny_face_detector|face_landmark_68|face_recognition)_model(-weights_manifest\.json|\.bin)$/.test(f)) continue;
    copyFileSync(path.join(faSrc, f), path.join(faDest, f));
  }
  console.log("[vision] face recognition models copied to public/models/face-api");
} else {
  console.log("[vision] @vladmandic/face-api not installed — skipping face recognition models");
}
