"use client";

import { useEffect } from "react";

/** Tells the server a person — a browser that ran this — opened the link. */
export default function WelcomeOpened({ code }: { code: string }) {
  useEffect(() => {
    fetch(`/w/${encodeURIComponent(code)}/opened`, { method: "POST" }).catch(() => {});
  }, [code]);
  return null;
}
