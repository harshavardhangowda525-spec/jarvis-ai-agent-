/**
 * Which motion state the ULTRON core shows for what the runtime is REALLY doing
 * (the tool it's running). Pure, so it can be tested and shared.
 */
export type ActivityState = "thinking" | "coding" | "debugging" | "building" | "deploying";
export type SystemNode = "NEURAL CORE" | "MEMORY" | "TERMINAL" | "REPOSITORY" | "NETWORK" | "DEPLOYMENT";

export function classifyTool(name: string, label = ""): ActivityState {
  const n = name.replace(/^(ultron|edith)\./, "");
  if (/^(write_file|edit_file|move_file|delete_file)$/.test(n)) return "coding";
  if (n === "deploy") return "deploying";
  if (/^(build|install)$/.test(n)) return "building";
  if (/^(test|lint|health_check)$/.test(n)) return "debugging";
  if (n === "run_command") {
    const l = label.toLowerCase();
    if (/\b(deploy|vercel|netlify|firebase deploy)\b/.test(l)) return "deploying";
    if (/\b(test|jest|vitest|pytest|lint|eslint|tsc|typecheck|check)\b/.test(l)) return "debugging";
    if (/\b(build|compile|install|npm i|pnpm i|yarn add|pip install)\b/.test(l)) return "building";
  }
  return "thinking";
}

/** The side system that lights up for a tool. */
export function toolNode(name: string, label = ""): SystemNode {
  const n = name.replace(/^(ultron|edith)\./, "");
  if (n === "read_file") return "MEMORY";
  if (/^(list_files|search_code|detect_project|write_file|edit_file|move_file|delete_file)$/.test(n) || n.startsWith("git_")) return "REPOSITORY";
  if (n === "deploy") return "DEPLOYMENT";
  if (n === "health_check") return "NETWORK";
  if (n === "run_command" && /\b(deploy|vercel|netlify)\b/i.test(label)) return "DEPLOYMENT";
  if (/^(run_command|build|install|test|lint)$/.test(n)) return "TERMINAL";
  return "NEURAL CORE";
}

/** Between tool calls: a "fix this bug" goal keeps the debugging scan going. */
export function goalIntent(goal: string): ActivityState {
  return /\b(debug|fix|bug|error|broken|crash|failing|not working)\b/i.test(goal) ? "debugging" : "thinking";
}

/** The state word shown at the top of the screen. */
export const STATE_WORD: Record<string, string> = {
  offline: "DORMANT", idle: "AWAKE", listening: "LISTENING", thinking: "THINKING", coding: "CODING",
  debugging: "DEBUGGING", building: "BUILDING", deploying: "DEPLOYING", await: "AWAITING APPROVAL",
  success: "COMPLETE", error: "INTERRUPTED",
};
