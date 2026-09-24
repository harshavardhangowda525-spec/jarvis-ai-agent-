/**
 * Workspace isolation. Every file/terminal operation is confined to the active
 * workspace root. Paths that resolve outside it are rejected. This is ULTRON's
 * primary safety boundary: it can only touch the workspace the user selected.
 */
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(__dirname, "../workspaces");

export class Workspace {
  constructor(root) {
    // ULTRON_WORKSPACE can point at an existing project; otherwise use ./workspaces.
    this.root = path.resolve(root || process.env.ULTRON_WORKSPACE || DEFAULT_ROOT);
    fs.mkdirSync(this.root, { recursive: true });
  }

  /** Resolve a workspace-relative path, guaranteeing it stays inside the root. */
  resolve(relPath) {
    const p = path.resolve(this.root, relPath ?? ".");
    const rel = path.relative(this.root, p);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`Path escapes the workspace: ${relPath}`);
    }
    return p;
  }

  /** A path shown to the user (relative to the workspace root). */
  display(absPath) {
    return path.relative(this.root, absPath) || ".";
  }

  setRoot(root) {
    this.root = path.resolve(root);
    fs.mkdirSync(this.root, { recursive: true });
  }
}
