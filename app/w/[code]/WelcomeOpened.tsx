"use client";

import { useEffect } from "react";

/** Tells the server a person — a browser that ran this — opened the link. */
export default function WelcomeOpened({ code }: { code: string }) {
  useEffect(() => {
    // B2368 — `keepalive` tells the browser to finish this request even if
    // the page is about to navigate away (a redirect for somebody already
    // signed in, or simply moving on quickly); without it the request shows
    // as `net::ERR_ABORTED` in the console although the server already
    // wrote the stamp before the connection closed.
    fetch(`/w/${encodeURIComponent(code)}/opened`, { method: "POST", keepalive: true }).catch(() => {});
  }, [code]);
  return null;
}
