import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * The policy every document on this instance is served under. B02.
 *
 * Nothing here is load-bearing today: there is no `rehype-raw`, so entry prose
 * cannot inject an element, and the one `dangerouslySetInnerHTML` is JSON-LD
 * built from typed fields. This is the second layer, and the reason to have
 * one is that `/<user>/join`, `/<user>/me` and the trip gate all take input on
 * the origin that holds the guest cookie. The day an XSS does appear — a new
 * component, a dependency, an upload path nobody has written yet — this is the
 * difference between a bug and a session.
 *
 * Two directives are doing most of the work and are worth naming:
 *
 * - `frame-ancestors 'none'` — the forms above were framable, and a framed
 *   sign-in form is a clickjacked one. `X-Frame-Options: DENY` says the same
 *   thing to a browser too old to read this.
 * - `form-action 'self'` — injected markup cannot post the fields of a form
 *   the reader is already filling in to somebody else's server.
 *
 * `'unsafe-inline'` stays in `script-src`, and it is honest to say what that
 * costs: an injected inline `<script>` would still run. Removing it means a
 * per-request nonce, which means proxy middleware and dynamic rendering on
 * every page — Next's own guide spells out that it disables static generation
 * outright. That is a real trade against a threat this codebase does not
 * currently have, and it is not this task's to make. What the policy still
 * buys with `'unsafe-inline'` present is the *next* step of an XSS: no script
 * from another origin, no `<object>`, no rewritten `<base>`, no form posting
 * off-site, and no exfiltration over `connect-src`.
 *
 * `next/font/google` self-hosts its files at build time, so no font host
 * appears here; the one `data:` in `font-src` is for the same reason `img-src`
 * has one — an inline SVG noise texture in globals.css.
 */
const documentCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  // Dev needs `eval`: React's refresh runtime uses it to rebuild server error
  // stacks. Production does not, and does not get it.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  // React writes `style` attributes (the skylines, the travel animation, the
  // charts), and a style attribute needs `'unsafe-inline'`.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // `'self'` covers same-origin websockets in CSP3, but dev's HMR socket is
  // the one thing that breaks silently if a browser disagrees.
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  // Only in production: over plain http on localhost this would upgrade the
  // dev server's own subresources to a port nothing is listening on.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

/**
 * And the policy a file out of somebody's content folder is served under.
 *
 * `.svg` is the reason. `lib/media.ts` maps it to `image/svg+xml` and an SVG
 * is a document that can carry script — `nosniff` is no help against a type
 * the server itself declared. No upload path can produce one today
 * (`lib/validate/media.ts` allowlists raster formats and derivatives are
 * re-encoded through sharp), so the only SVGs on disk are the generated
 * placeholders the example content ships. That makes this a latent footgun
 * rather than a live hole, and this header is what keeps it latent whatever
 * else changes: `default-src 'none'` leaves nothing for a script to reach and
 * `sandbox` drops the file into an opaque origin, so it is no longer same-site
 * with the session cookie even if it is navigated to directly.
 *
 * It has to be a *separate, later* rule rather than part of the baseline:
 * Next applies every matching rule in order and the last to set a key wins, so
 * ordering is what makes a media file get this policy instead of the
 * document one. The route handler sets the same header itself, because a
 * policy this load-bearing should not depend on a path pattern staying in step
 * with the route tree.
 */
const mediaCsp = "default-src 'none'; sandbox";

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
    ];
  },
  /**
   * B02. Set here rather than in `deploy/Caddyfile` because the Caddyfile is a
   * reference snippet a self-hoster may merge, replace or never use, and a
   * security header that only exists in one deployment's proxy config is a
   * header this software does not have. Caddy passes these through untouched.
   */
  async headers() {
    return [
      {
        // Everything: pages, API routes, the RSC payload, `.md` twins.
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: documentCsp },
          // What leaves the origin in a `Referer`. Cross-origin gets the
          // origin only, so a shared trip URL — which is the secret, for a
          // `listed: false` trip — never reaches somebody else's logs.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // `frame-ancestors` says this already; this is for what cannot read it.
          { key: "X-Frame-Options", value: "DENY" },
          // Two years, subdomains included. No `preload`: that is a commitment
          // kept in other people's browsers for years, it is not this
          // software's to make on a self-hoster's domain, and it cannot be
          // withdrawn quickly. Browsers ignore this header when it arrives
          // over plain http, so local dev is unaffected.
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
      {
        // After the baseline, so it overrides it. See `mediaCsp`.
        source: "/:user/media/:path*",
        headers: [{ key: "Content-Security-Policy", value: mediaCsp }],
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
