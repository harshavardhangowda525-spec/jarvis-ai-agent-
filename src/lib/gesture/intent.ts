/** "Enable gesture mode" / "Disable gesture mode" / "Gesture mode". Pure. */
export function gestureModeCommand(text: string): "on" | "off" | null {
  const t = text.toLowerCase().replace(/[.!?]+$/, "").replace(/^(jarvis|hey jarvis)[,\s]+/, "").trim();
  if (!/\bgesture(s)?\b|\bhand (tracking|control|gestures)\b/.test(t)) return null;
  if (/\b(disable|deactivate|turn off|switch off|stop|exit|end|close|leave)\b/.test(t) || /\boff\b/.test(t)) return "off";
  if (/\b(enable|activate|turn on|switch on|start|open|enter|use)\b/.test(t) || /^gesture(s)? (mode|control)( on)?$/.test(t) || /\bon\b/.test(t)) return "on";
  return null;
}
