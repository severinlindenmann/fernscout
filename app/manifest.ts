import type { MetadataRoute } from "next";
import { serverSite } from "@/lib/site";

/**
 * The installed app's identity.
 *
 * ## What the link-capturing fields can and cannot buy — B430
 *
 * A sign-in link in an email should land in the installed app rather than a
 * browser tab, because on a phone those are two different places with two
 * different cookie jars. How far that is achievable is entirely the platform's
 * decision, and it is worth writing down so nobody re-litigates it against a
 * device where it silently does nothing:
 *
 * - **Android / desktop Chromium**: `handle_links` and the user's "open
 *   supported links" setting can send an in-scope URL to the installed app,
 *   and its storage is shared with the browser either way, so the sign-in is
 *   not lost when it is not captured.
 * - **iOS**: a home-screen web app has its **own storage container**, separate
 *   from Safari, and Safari does not hand https links to it. A link tapped in
 *   Mail therefore signs the reader into Safari and leaves the installed app
 *   signed out — while looking like it worked. Nothing in this file changes
 *   that, which is why the mail leads with the six-digit code and says, in
 *   words, to type it into the app instead.
 *
 * `scope` and `id` are stated rather than left to default so that neither
 * moves if `start_url` is ever changed: `id` is what a browser matches an
 * already-installed app by, and an app whose id changes installs twice.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: serverSite().name,
    short_name: serverSite().name,
    description: "",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fffaf0",
    theme_color: "#ffd23f",
    // Reuse the window that is already open and take it to the link's URL,
    // rather than opening a second copy of the app beside it.
    launch_handler: { client_mode: "navigate-existing" },
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    /**
     * Declarative link capturing. Chromium reads it; the spec is not final and
     * Next's `Manifest` type does not carry it, hence the cast — the
     * alternative is not shipping the one field that makes the button open the
     * app at all on the platform where it can.
     */
    ...({ handle_links: "preferred" } as Record<string, unknown>),
  };
}
