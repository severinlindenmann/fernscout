import { nearestWidth } from "@/lib/mediaSizes";

/**
 * Where `<Image>` gets a trip photograph from.
 *
 * Not Next's optimiser, and it cannot be. The optimiser answers `/_next/image`
 * by re-fetching the source *server-side*, through a mock request built from
 * the URL and nothing else — no cookies, no headers. Our media route asks who
 * is reading before it serves anything, sees an anonymous request, and returns
 * 404; the optimiser turns an empty body into a 400. The visible result is a
 * page of blank squares on every trip that is not public, for its own
 * travellers as much as for a stranger, and a row of 400s in the console with
 * nothing to say why.
 *
 * So the media route resizes its own files. It is the only thing in the
 * request path that already knows whether this reader may see them.
 */
export function mediaLoader({ src, width }: { src: string; width: number }): string {
  // Absolute URLs are somebody else's server, and the placeholders the demo
  // content ships are SVG — a resize would rasterise them for nothing.
  if (/^https?:/.test(src) || src.endsWith(".svg")) return src;
  return `${src}?w=${nearestWidth(width)}`;
}

/**
 * A clip's still frame, at one of the widths the route makes.
 *
 * `poster` takes a single URL — no `srcset`, no `sizes` — so it was handed
 * the stored frame as it is: the full 2000px JPEG ingest writes, once per
 * clip in a grid of tiles a couple of hundred pixels wide. One width per
 * place it is drawn (`POSTER_WIDTH`) is what a single URL can do, and the
 * same two widths `keep.json` lists, so a trip kept for offline reading
 * already holds exactly these.
 */
export function posterSrc(poster: string | undefined, width: number): string | undefined {
  return poster ? mediaLoader({ src: poster, width }) : undefined;
}
