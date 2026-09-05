import fs from "node:fs";
import path from "node:path";
import { GUIDES } from "@/lib/docs";

/**
 * The screenshots inside the reader guides — B456.
 *
 * The same arrangement as `docs/screenshots`, and for the same reason: these
 * are repository documentation rather than site assets, so they live outside
 * `public/` and one route reads across that boundary on a **fixed allowlist**
 * rather than on a path a request can steer.
 *
 * The allowlist is built rather than typed out, from the guides that exist and
 * the languages they are captured in — a ninth figure is then a file plus a
 * name in `FIGURES`, and a request for anything else is a 404 whatever it
 * spells.
 */
const LANGUAGES = ["en", "de"] as const;
/** Which screens are captured, per language. Not every guide needs every one. */
const FIGURES = ["signin", "signin-form", "signin-code", "home", "notify"] as const;

/**
 * Figures with no language of their own — B477.
 *
 * These two are photographs of **iOS**, not of this site: the menu that offers
 * Share, and the share sheet that holds "Add to Home Screen". Their words come
 * from the phone's own language rather than from ours, so capturing one per
 * locale would produce three pictures of an English iPhone. The guides say so
 * in the caption instead.
 */
const UNLOCALISED = ["ios-share", "ios-add-home"] as const;

const ALLOWED = new Set([
  ...LANGUAGES.flatMap((lang) => FIGURES.map((figure) => `guide-${figure}-${lang}.webp`)),
  ...UNLOCALISED.map((figure) => `${figure}.webp`),
]);

/** `GUIDES` is imported so this file fails to compile if the guides are ever
 * renamed out from under the figures — the names are related and nothing else
 * holds them together. */
void GUIDES;

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!ALLOWED.has(file)) return new Response("Not found", { status: 404 });

  let body: Buffer;
  try {
    body = fs.readFileSync(path.join(process.cwd(), "docs/guides/figures", file));
  } catch {
    // Named in the allowlist but not on disk: a half-finished capture, not a
    // request worth a 500.
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(body.byteLength),
      // Committed files that change only when somebody recaptures them by
      // hand, which is rare. A day is enough to notice a stale one.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
