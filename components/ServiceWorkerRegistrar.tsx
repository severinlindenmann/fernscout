"use client";

import { useEffect } from "react";

/** Registers the service worker. Separate from the notification UI because the
 * worker also does the offline caching, which everyone benefits from whether
 * or not they ever turn notifications on. */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    /*
     * Development gets no worker, and the existing one is torn down rather
     * than merely left unregistered.
     *
     * A worker is scoped to the origin, and `npm start` and `npm run dev`
     * share localhost — so running the production build once installs a
     * worker that then controls every dev session on that port, serving the
     * previous build's assets to a dev server that has recompiled underneath
     * it. The symptom is a click on an in-site link sitting on "Rendering…"
     * for a long time and sometimes never arriving.
     *
     * The offline behaviour is still testable exactly where it should be
     * tested: `npm run build && npm start`.
     */
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => undefined);
      // Its caches outlive it, and a stale asset served from one is the same
      // bug without the worker. Only ours — nothing else on the origin.
      void caches
        ?.keys()
        .then((names) =>
          Promise.all(
            names.filter((n) => /^(shell|runtime)-/.test(n)).map((n) => caches.delete(n)),
          ),
        )
        .catch(() => undefined);
      return;
    }

    // After load, so registration never competes with the first render.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Blocked by settings, or not on a secure origin. Nothing to do —
        // the site works exactly as before without it.
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
