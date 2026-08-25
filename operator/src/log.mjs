/** Minimal timestamped logger for the operator service. */
const ts = () => new Date().toISOString().slice(11, 19);

export const log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  warn: (...a) => console.warn(`[${ts()}] ⚠`, ...a),
  error: (...a) => console.error(`[${ts()}] ✖`, ...a),
  action: (...a) => console.log(`[${ts()}] ▸`, ...a),
};
