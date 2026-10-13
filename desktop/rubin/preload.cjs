"use strict";
/**
 * The only bridge between the island page and the desktop: a handful of window
 * actions and the island's own settings. No Node, no file access, no secrets.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rubinDesktop", {
  version: process.env.npm_package_version || "1.0.0",
  setOpen: (open) => ipcRenderer.send("rubin:open", !!open),
  setInteractive: (on) => ipcRenderer.send("rubin:interactive", !!on),
  dragStart: () => ipcRenderer.send("rubin:drag", true),
  dragEnd: () => ipcRenderer.send("rubin:drag", false),
  openAuth: (path) => ipcRenderer.send("rubin:auth", String(path)),
  getSettings: () => ipcRenderer.invoke("rubin:settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("rubin:settings:set", patch),
  onCommand: (cb) => {
    const h = (_e, c) => cb(c);
    ipcRenderer.on("rubin:command", h);
    return () => ipcRenderer.removeListener("rubin:command", h);
  },
  retry: () => ipcRenderer.send("rubin:retry"),
});
