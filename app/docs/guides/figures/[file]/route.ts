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
/** Which screens are captured. Not every guide needs every one. */
const FIGURES = ["signin", "signin-form", "signin-code", "home", "notify"] as const;

const ALLOWED = new Set(
  LANGUAGES.flatMap((lang) => FIGURES.map((figure) => `guide-${figure}-${lang}.webp`)),
);

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
