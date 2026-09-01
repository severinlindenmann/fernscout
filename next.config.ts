import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Where the build goes. `.next` unless told otherwise.
   *
   * `next build` rewrites this directory underneath whatever is serving it, so
   * building while a server is up leaves that server with a half-replaced
   * build and 500s on pages that are fine — which looks exactly like a
   * regression you just wrote. Pointing a build somewhere else is the way to
   * check a change without stopping what is already running:
   *
   *   NEXT_DIST_DIR=.next-preview npm run build
   *   NEXT_DIST_DIR=.next-preview PORT=3700 npm start
   *
   * Unset in every normal case, including on the server.
   *
   * One side effect worth knowing: a build with this set makes Next add
   * `.next-preview/types/**` to `tsconfig.json` include list. That is an
   * artefact of the preview, not a change to the project — discard it.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native and CJS database drivers, loaded through `require` at runtime
  // rather than bundled. Next already externalises both by default; naming
  // them here means a change to that default list can't quietly break the
  // build. Only one of the two is ever actually loaded — see lib/db/client.ts.
  serverExternalPackages: ["better-sqlite3", "pg"],
  // Markdown twins: appending `.md` to a day page's URL serves its source. A
  // route handler and a page cannot share a path, so the suffix is rewritten
  // to a handler rather than routed directly.
  //
  // Both of a day's URLs, not just the short one. `/:user/day/:slug` is the
  // current trip's day; every day also lives at
  // `/:user/trips/:trip/day/:slug`, and that is the form the search index and
  // the documentation identify entries by. Only the first was rewritten, so
  // the documented `.md` URL 404'd for every trip but the current one — and
  // the trip-scoped attempt fell through to the app and answered with the HTML
  // 404 page, which is a bad thing to hand an agent in a loop.
  //
  // The trip-scoped rewrite goes first: `:trip/day/:slug` would otherwise be
  // matched by nothing, but keeping the more specific pattern above the
  // general one is how this file stays readable when a third form appears.
  async rewrites() {
    return [
      { source: "/:user/trips/:trip/day/:slug.md", destination: "/api/md/:user/:trip/:slug" },
      {
        source: "/:user/trips/:trip/day/:slug([^/]+)\\.md",
        destination: "/api/md/:user/:trip/:slug",
      },
      { source: "/:user/day/:slug.md", destination: "/api/md/:user/:slug" },
      { source: "/:user/day/:slug([^/]+)\\.md", destination: "/api/md/:user/:slug" },
      // RFC 9728 protected-resource metadata for the MCP endpoint. Rewritten
      // rather than routed because a dot-prefixed segment is not an App Router
      // path, and served at both forms because the RFC builds the URL by
      // inserting the well-known segment *before* the resource's own path.
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      {
        source: "/.well-known/oauth-protected-resource/:path*",
        destination: "/api/well-known/oauth-protected-resource",
      },
    ];
  },
  images: {
    // The example content set uses generated SVG placeholders, served from
    // content/ through app/media/[...path]. Real trip photos and videos are
    // JPEG/MP4, but SVG stays supported so a fresh clone renders.
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
