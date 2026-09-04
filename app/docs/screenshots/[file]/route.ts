import fs from "node:fs";
import path from "node:path";

/**
 * The screenshots `/docs` shows are `docs/screenshots/*.jpg` — the same four
 * files the root `README.md` already embeds — served from here rather than
 * duplicated into `public/`. `docs/screenshots/README.md` explains why they
 * live outside `public/` in the first place: that folder is served to
 * browsers and these are repository documentation, committed under a tight
 * byte budget. Copying them into `public/` would both break that boundary
 * and ship the same bytes twice. This route is the one place that reads
 * across it, on a fixed allowlist rather than a path a request can steer.
 */
const ALLOWED = new Set(["trip-story.jpg", "day-entry.jpg", "trip-map.jpg", "gallery.jpg"]);

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  if (!ALLOWED.has(file)) return new Response("Not found", { status: 404 });

  const body = fs.readFileSync(path.join(process.cwd(), "docs/screenshots", file));
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(body.byteLength),
      // Committed files, named by content — a changed screenshot is a new
      // commit under the same name, but that only ever happens by hand and
      // rarely. A day is enough to notice a stale one without hammering disk
      // on every view of the page that shows them.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
