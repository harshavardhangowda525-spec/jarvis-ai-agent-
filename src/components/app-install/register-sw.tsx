"use client";

import { useEffect } from "react";

/** Registers the small app service worker (installable app + offline screen). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* the site still works without it */ });
  }, []);
  return null;
}
