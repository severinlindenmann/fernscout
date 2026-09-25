import type { CapacitorConfig } from "@capacitor/cli";
import config from "./site/config.json";

/**
 * The iPhone shell — B2104.
 *
 * The app loads its pages from the running site rather than bundling them:
 * this app has server routes and cannot be statically exported, and a shell
 * that follows the deploy needs no store release for a page change. The
 * address is the site's own from `site/config.json`, so a self-hoster's
 * clone builds a shell for their instance; `CAPACITOR_SERVER_URL` points a
 * build at a local checkout (use the Mac's LAN address, not localhost, for a
 * physical iPhone).
 *
 * `webDir` only feeds the bundled `index.html` the WebView shows for the
 * instant before the first page arrives.
 */
const capacitorConfig: CapacitorConfig = {
  appId: "ch.fernscout.app",
  appName: config.site.name,
  // The WebView's own ground for the instant between the launch screen and
  // the first page — cream, the page's `--color-cream-50`, instead of
  // WebKit's white. The launch screen itself is the mark on cream from
  // `npm run avatar` (B2124); this is what follows it.
  backgroundColor: "#fffaf0",
  webDir: "ios/www",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? config.site.url,
    cleartext: process.env.CAPACITOR_SERVER_URL?.startsWith("http:") ?? false,
  },
};

export default capacitorConfig;
