"use strict";
/**
 * The only bridge between the orb page and this computer. The page hands over
 * the words you said or typed; the main process plans, asks you (native
 * dialogs) and acts. No Node, no files, no secrets reach the page.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvisDesktop", {
  version: "2.0.0",
  /** Words → { handled, reply, results, clarify?, pending?, launcher?, control? } (handled:false = ask JARVIS's brain). */
  run: (text, ctx) => ipcRenderer.invoke("orb:run", String(text), ctx && typeof ctx === "object" ? { pending: ctx.pending === "open" ? "open" : null } : {}),
  apps: () => ipcRenderer.invoke("orb:apps"),
  openApp: (name) => ipcRenderer.invoke("orb:open-app", String(name)),
  stop: () => ipcRenderer.send("orb:stop"),
  pause: (on) => ipcRenderer.send("orb:pause", !!on),
  state: () => ipcRenderer.invoke("orb:state"),
  getSettings: () => ipcRenderer.invoke("orb:settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("orb:settings:set", patch),
  setMode: (mode) => ipcRenderer.send("orb:mode", mode === "popup" ? "popup" : "orb"),
  setInteractive: (on) => ipcRenderer.send("orb:interactive", !!on),
  dragStart: () => ipcRenderer.send("orb:drag", true),
  dragEnd: () => ipcRenderer.send("orb:drag", false),
  hide: () => ipcRenderer.send("orb:hide"),
  quit: () => ipcRenderer.send("orb:quit"),
  retry: () => ipcRenderer.send("orb:retry"),
  onEvent: (cb) => {
    const h = (_e, ev) => cb(ev);
    ipcRenderer.on("orb:event", h);
    return () => ipcRenderer.removeListener("orb:event", h);
  },
});
