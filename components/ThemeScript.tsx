"use client";

import { THEME_BOOTSTRAP } from "@/lib/theme";

/**
 * Runs as JavaScript in the server-rendered document, before first paint, but
 * becomes inert if React ever has to render the root layout on the client.
 * This is Next's inline-script pattern: it avoids both a light flash on hard
 * navigation and React's warning about script tags on a client render.
 */
export default function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }}
    />
  );
}
