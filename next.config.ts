import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { REQUEST_MAX_BYTES } from "./lib/validate/media";

/**
 * Open core: `@paid/*` resolves to `paid/` when that folder is present and to
 * `lib/paid-stubs/` otherwise, file by file (tsconfig.json paths). A paid/
 * checkout missing a file would therefore fall back to its stub silently and
 * ship a feature half switched off — so a build with paid/ present refuses
 * unless every stub has its real counterpart.
 */
function assertPaidCoversStubs(): void {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, "paid"))) {
    // The operator's own instance sets this, so a build that lost its paid/
    // checkout fails here instead of shipping with every paid feature stubbed.
    if (process.env.FERNSCOUT_REQUIRE_PAID === "1") {
      throw new Error("FERNSCOUT_REQUIRE_PAID=1 but there is no paid/ checkout beside next.config.ts");
    }
    return;
  }
  const modules = (dir: string) =>
    new Set(
      (fs.readdirSync(path.join(root, dir), { recursive: true }) as string[])
        .filter((f) => !f.split(path.sep).includes(".git") && /\.(tsx?|mts)$/.test(f))
        .map((f) => f.replace(/\.(tsx?|mts)$/, "")),
    );
  const real = modules("paid");
  const missing = [...modules("lib/paid-stubs")].filter((f) => !real.has(f));
  if (missing.length > 0) {
    throw new Error(`paid/ is present but has no counterpart for these stubs in lib/paid-stubs/:\n  ${missing.join("\n  ")}`);
  }
}
assertPaidCoversStubs();

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
  // B1089: don't advertise the framework to every caller. One less free hint
  // for a scanner deciding which exploits to try; costs nothing.
  poweredByHeader: false,
  /**
   * How much of a request body Next buffers before a route ever sees it — B523.
   *
   * This exists because `proxy.ts` exists: Next clones and buffers the body of
   * a proxied request so it can be read twice, and past this limit it
   * truncates rather than refusing. The default is 10 MB, which silently cut
   * every photograph a current phone takes down to something
   * `request.formData()` could not parse — reported as `expected_multipart`,
   * which is a lie about which end the problem was at.
   *
   * The number is `lib/validate/media.ts`'s, not one typed here, so the
   * documented cap and the enforced one are the same value. Read that constant
   * before raising it: it is buffered in memory.
   */
  experimental: { proxyClientMaxBodySize: REQUEST_MAX_BYTES },
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
   * Unset in every normal case except one: `scripts/deploy.sh` builds into
   * `.next-build` and swaps it in while the service is stopped (B2230), which
   * is why `tsconfig.json` lists `.next-build/types` too.
   *
   * One side effect worth knowing: a build with this set makes Next add
   * `.next-preview/types/**` to `tsconfig.json` include list. That is an
   * artefact of the preview, not a change to the project — discard it.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Native and CJS packages, loaded through `require` at runtime rather than
  // bundled. Next already externalises these by default; naming them here
  // means a change to that default list can't quietly break the build. Only
  // one of the two drivers is ever actually loaded — see lib/db/client.ts.
  //
  // **`sharp` earns its place the hard way** — B1335. It is a native binding,
  // and a build that bundled it left the server unable to find it at all:
  //
  //     Failed to load external module sharp-20c6a5da84e2135f:
  //     Cannot find package 'sharp-20c6a5da84e2135f'
  //
  // Ordering a photobook answered 500 on the live instance, because
  // `paid/photobook/lib/photobook/images.ts` re-encodes every photograph through it (B1172).
  // `lib/api/media.ts` and `lib/ingest/image.ts` load it too and had been
  // getting away with it.
  serverExternalPackages: ["better-sqlite3", "pg", "sharp"],
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
  /**
   * Old addresses that must converge rather than 404 — B1825 and B1826.
   *
   * `statusCode: 301` rather than `permanent: true` (which would be 308):
   * `docs/plans/2026-09-17-the-studio.md` says "301s" plainly, and a `308`,
   * while functionally equivalent for a `GET`, is not what was asked for.
   *
   * **B1825** absorbed `/<user>/extract`'s five pages into the studio
   * (spec.md §3): the hub itself, and its guided photographs and location
   * flows, all now live under `/<user>/studio`, at the same addresses the
   * hub already links to. `/extract/costs` converged on `/studio/costs`
   * until B2083 retired that duplicate of the statement flow; both now land
   * on `/studio/statement` (the page file redirects, this line skips a hop).
   *
   * **B1921** retired `/studio/contacts` (and `/extract/contacts` with it):
   * `NonPhotoImport`'s `contacts` kind only ever staged a vCard and pointed
   * at `/agent` to finish, and `/[user]/studio/people` (`PeopleFlow`, B1823)
   * already does that whole job — read, peek with reasons, decide, file —
   * without the detour. Both old addresses converge there now.
   *
   * **B1826** deleted `/docs/extract` once B1825 gave the photographs and
   * location flows their own address to carry that guidance in place —
   * spec.md §4, the self-sufficiency rule. `/docs/*` is not user-scoped, so
   * this converges on the surviving `/docs/helper` rather than on any one
   * journal's studio. `/docs/guide/buddy` and `/docs/guide/creator` are
   * **not** redirected here — B1826 found a live page still depends on them
   * (`lib/docs.ts`'s own doc comment on `GUIDES` says which, and why they
   * were kept rather than deleted).
   */
  async redirects() {
    return [
      { source: "/:user/extract", destination: "/:user/studio", statusCode: 301 },
      { source: "/:user/extract/photos", destination: "/:user/studio/photos", statusCode: 301 },
      { source: "/:user/extract/location", destination: "/:user/studio/location", statusCode: 301 },
      { source: "/:user/extract/contacts", destination: "/:user/studio/people", statusCode: 301 },
      { source: "/:user/studio/contacts", destination: "/:user/studio/people", statusCode: 301 },
      { source: "/:user/extract/costs", destination: "/:user/studio/statement", statusCode: 301 },
      { source: "/docs/extract", destination: "/docs/helper", statusCode: 301 },
    ];
  },
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
      {
        // B287: `/:user/contacts` carries decrypted postal addresses and, since
        // B280, live invite URLs — each one a credential. `/:user/me` carries a
        // handover credential since B283. Both pages already set
        // `dynamic = "force-dynamic"`, which makes Next default to
        // `no-store` — this pins that default explicitly, so a framework
        // upgrade changing it cannot quietly leave either page cacheable on
        // a shared laptop, a corporate middlebox, or a browser's back button.
        source: "/:user/contacts",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // B2092: the same page, moved into the studio. The old address above
        // only redirects now, but keeps its pin until nothing links to it.
        source: "/:user/studio/readers",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:user/me",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        // B1635: the approval token rides in this page's URL fragment, which
        // a browser never sends to a server on its own — but the baseline
        // above still lets the *origin* leave in a cross-origin `Referer`,
        // and this page's only job is to be safe to open from a mail client
        // that may load its own remote assets. `no-referrer` here means
        // nothing this page loads carries any part of its URL onward, fragment
        // included.
        source: "/:user/payment/:id/approve",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
      {
        // B1690: same shape as B1635 above, for the two other token-in-path
        // links. The deletion confirmation page and its export download both
        // carry a token that destroys or exports a journal; the guest/buddy
        // invite links carry a lower-stakes one (an invite only creates a
        // request, per AGENTS.md), but the fix is the same one-line
        // `no-referrer` either way. `export.zip` genuinely needs the token in
        // the path — a `GET` reads no fragment — so this only stops the
        // token leaving in a `Referer` header, which is still the actual
        // leak this ticket closes; whether the token belongs in the path at
        // all is a separate, owner-level decision.
        source: "/:user/delete/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/:user/delete/:token/export.zip",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      {
        source: "/:user/invite/:kind/:token",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
      // B2292. The welcome link's code is in the path (B1970 option (a)): it
      // grants nothing, and it still never leaves in a Referer header.
      {
        source: "/w/:code*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
      // B1087: every /api/v1 route is authenticated and `force-dynamic`, and the
      // auth flows carry codes and session state — none of it belongs in any
      // cache. Pinned here (not just relied on from `force-dynamic`) so a shared
      // proxy, a service worker or a framework default can never hold an
      // owner-only response. `/api/md` (the public markdown twins) and
      // `/api/health` set their own cache policy and are deliberately not here.
      {
        source: "/api/v1/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/api/auth/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
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
