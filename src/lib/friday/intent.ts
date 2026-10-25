/**
 * Spoken/typed commands for FRIDAY (client-safe, no AI round trip).
 *
 * The workspace switch is a command, not a topic: "activate agentic view"
 * switches; "what does activate agentic view do?", "don't activate agentic
 * view yet" or "type 'activate agentic view' to switch" do not — the whole
 * utterance has to BE the command (an optional "Friday,"/"please" around it).
 */
const LEAD = String.raw`^(?:(?:hey |ok |okay )?(?:friday|jarvis)[,!.\s]+)?(?:please\s+|now\s+|ok(?:ay)?[,\s]+)*(?:(?:can|could|would|will) you\s+)?`;
const TAIL = String.raw`(?:\s+(?:please|now|mode))?(?:\s+please)?[.!\s]*$`;
const VIEW = String.raw`(?:the\s+|your\s+)?(?:agentic|agent(?:ic)?\s+(?:view|mode|workspace)|holographic|hologram|3d|three[- ]d)\s*(?:view|mode|workspace|work\s*space|interface|ui)?`;

export type ModeCommand = "activate" | "deactivate";

export function modeCommand(text: string): ModeCommand | null {
  const t = text.trim().toLowerCase().replace(/[’']/g, "'");
  if (!t || /["“”`]|'(?:activate|deactivate)/.test(t)) return null; // quoting the phrase is talking about it
  if (new RegExp(`${LEAD}(?:activate|enable|enter|open|launch|start|show(?: me)?|switch (?:to|into)|go (?:to|into)|turn on|bring up)\\s+${VIEW}${TAIL}`).test(t)) return "activate";
  if (new RegExp(`${LEAD}go agentic${TAIL}`).test(t)) return "activate";
  if (new RegExp(`${LEAD}(?:deactivate|disable|exit|leave|close|quit|turn off|end|stop)\\s+${VIEW}${TAIL}`).test(t)) return "deactivate";
  if (new RegExp(`${LEAD}(?:(?:go\\s+)?back to|return to|switch (?:back )?to|exit to)\\s+(?:the\\s+)?(?:normal\\s+|regular\\s+|plain\\s+)?(?:chat|chatbot|chat mode|chat view|conversation)${TAIL}`).test(t)) return "deactivate";
  return null;
}

/** "Friday", "open Friday", "activate Friday" — not "on Friday", "this Friday", "Friday at 5". */
export function isFridayActivation(text: string): boolean {
  const low = text.trim().toLowerCase();
  const F = "(?:friday|fryday|f\\.r\\.i\\.d\\.a\\.y\\.?)";
  return new RegExp(`^${F}[\\s!.,?]*$|^(?:(?:hey |ok |okay )?jarvis[,!.\\s]+)?(?:please\\s+)?(?:open|launch|activate|start|switch to|go to|bring up|talk to|call)\\s+${F}(?:'s (?:workspace|app))?[\\s!.]*(?:please)?[\\s!.]*$|^${F}[,\\s]+(?:online|wake up|come online|are you there)\\b`).test(low);
}

const VERB = "(?:model|build|create|make|design|render|draw|sculpt|visuali[sz]e|generate|show|open|change|edit|update|export|re-?render|turn|give|load|compare|list)";

/**
 * Work for Friday, said to JARVIS: "Friday, model the EDITH glasses", "make a
 * 3D model of my drone", "render my invention in 3D". Returns the words to hand
 * Friday (its own brain decides the action). Weekday talk never counts.
 */
export function fridayCommand(text: string): string | null {
  const t = text.trim();
  const low = t.toLowerCase();
  const direct = new RegExp(`^(?:(?:hey |ok |okay )?jarvis[,!.\\s]+)?(?:(?:ask|tell|get|have)\\s+)?friday(?:,|\\s+to)\\s*(?:please\\s+)?(?:(?:can|could|would|will) you\\s+)?${VERB}\\b`).exec(low);
  if (direct) return t.replace(/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:(?:ask|tell|get|have)\s+)?friday(?:,|\s+to)\s*/i, "").trim();
  if (/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:how|what|why|when|where|which|who|is|are|does|do|should)\b/.test(low)) return null;
  if (/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:please\s+)?(?:i (?:want|need|would like) (?:you )?(?:to )?)?(?:build|create|make|design|render|generate|do)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:3d|three[- ]d)\s+(?:model|render|rendering|visuali[sz]ation|concept|mock-?up)\b/.test(low)
    || /^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)?(?:please\s+)?(?:(?:can|could|would|will) you\s+)?(?:model|render|visuali[sz]e)\s+.{3,}\s+in\s+(?:3d|three[- ]d|blender)\b/.test(low)) {
    return t.replace(/^(?:(?:hey |ok |okay )?jarvis[,!.\s]+)/i, "").trim();
  }
  return null;
}

export type ViewCommand =
  | { kind: "preset"; preset: "front" | "rear" | "left" | "right" | "top" | "bottom" | "iso" | "iso_rear" }
  | { kind: "shading"; shading: "material" | "solid" | "wireframe" }
  | { kind: "explode"; amount: number }
  | { kind: "section"; on: boolean }
  | { kind: "projection"; ortho: boolean }
  | { kind: "reset" } | { kind: "fullscreen" } | { kind: "gallery" }
  | { kind: "zoom"; factor: number } | { kind: "rotate"; yaw: number };

/**
 * Instant viewer commands (no AI round trip): "top view", "show me the back",
 * "wireframe", "explode it", "section view", "reset view", "orthographic"…
 * Only short, whole commands — "make the top thinner" is a model change for
 * Friday's brain, not a camera move.
 */
export function viewCommand(text: string): ViewCommand | null {
  const t = text.trim().toLowerCase().replace(/^(?:(?:hey |ok |okay )?(?:friday|jarvis)[,!.\s]+)?(?:please\s+)?(?:(?:can|could) you\s+)?/, "").replace(/(?:\s+please)?[.!\s]*$/, "");
  if (t.split(/\s+/).length > 6) return null;
  const P: [RegExp, ViewCommand][] = [
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?front(?:\s+view)?$/, { kind: "preset", preset: "front" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?(?:back|rear)(?:\s+view)?$/, { kind: "preset", preset: "rear" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?left(?:\s+side)?(?:\s+view)?$/, { kind: "preset", preset: "left" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?right(?:\s+side)?(?:\s+view)?$/, { kind: "preset", preset: "right" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?top(?:\s+view)?$/, { kind: "preset", preset: "top" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?(?:bottom|underside)(?:\s+view)?$/, { kind: "preset", preset: "bottom" }],
    [/^(?:(?:show|go to|switch to|give me)\s+(?:me\s+)?)?(?:the\s+)?(?:iso(?:metric)?|three[- ]quarter|3\/4|perspective)\s+view$/, { kind: "preset", preset: "iso" }],
    [/^(?:show\s+|switch to\s+)?(?:the\s+)?wire ?frame(?:\s+(?:view|mode))?$/, { kind: "shading", shading: "wireframe" }],
    [/^(?:show\s+|switch to\s+)?(?:the\s+)?solid(?:\s+(?:view|mode|shading))?$/, { kind: "shading", shading: "solid" }],
    [/^(?:show\s+|switch to\s+)?(?:the\s+)?(?:materials?|textured?|rendered)(?:\s+(?:view|mode|preview))?$/, { kind: "shading", shading: "material" }],
    [/^(?:explode(?:\s+(?:it|the model|view))?|exploded\s+view|show(?: me)? (?:the )?exploded view|take it apart)$/, { kind: "explode", amount: 1 }],
    [/^(?:collapse(?:\s+it)?|unexplode|assemble(?:\s+it)?|put it back together|close (?:the )?exploded view)$/, { kind: "explode", amount: 0 }],
    [/^(?:section(?:\s+view)?|cut ?away(?:\s+view)?|cross[- ]section|show (?:the )?(?:inside|section|cutaway))$/, { kind: "section", on: true }],
    [/^(?:(?:close|hide|remove) (?:the )?(?:section|cutaway)|no section)$/, { kind: "section", on: false }],
    [/^(?:switch to\s+)?ortho(?:graphic)?(?:\s+(?:view|camera|mode))?$/, { kind: "projection", ortho: true }],
    [/^(?:switch to\s+)?perspective(?:\s+(?:camera|mode))?$/, { kind: "projection", ortho: false }],
    [/^(?:reset(?:\s+(?:the\s+)?(?:view|camera))?|centre it|center it|recenter|re-?centre)$/, { kind: "reset" }],
    [/^(?:full ?screen|go full ?screen)$/, { kind: "fullscreen" }],
    [/^(?:(?:open|show)(?: me)?\s+)?(?:the\s+)?(?:render\s+)?gallery$|^(?:show(?: me)?\s+)?(?:the\s+)?renders$/, { kind: "gallery" }],
    [/^zoom in$/, { kind: "zoom", factor: 0.75 }], [/^zoom out$/, { kind: "zoom", factor: 1.33 }],
    [/^(?:rotate|turn|spin) (?:it )?left$/, { kind: "rotate", yaw: -Math.PI / 4 }], [/^(?:rotate|turn|spin) (?:it )?right$/, { kind: "rotate", yaw: Math.PI / 4 }],
  ];
  for (const [re, c] of P) if (re.test(t)) return c;
  return null;
}
