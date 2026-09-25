/**
 * How much of a file one range request may pull — B669.
 *
 * A player asking for `bytes=0-` means "the rest of it", and answering that
 * literally for a 200 MB clip is 200 MB held in memory per viewer. A server
 * may return fewer bytes than were asked for, so it returns a window and the
 * player comes back for the next one; that is what every video element does
 * anyway once it knows ranges are available.
 */
const RANGE_WINDOW_BYTES = 4 * 1024 * 1024;

/**
 * The one `Range` form that matters, against a known size — B669.
 *
 * `bytes=start-end`, `bytes=start-` and `bytes=-suffix`, which is the whole
 * of what a browser sends for media. A header this does not understand comes
 * back as `undefined` and is served as an ordinary 200, which is what the
 * spec asks for; a range that cannot be satisfied comes back as `"invalid"`
 * and earns a 416, because silently sending the whole file to a player that
 * asked for byte 500 of a 100-byte file is the failure that is hard to see.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "invalid" | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, from, to] = match;
  if (from === "" && to === "") return undefined;

  // `bytes=-500` is the last 500 bytes, not "up to 500".
  let start = from === "" ? size - Number(to) : Number(from);
  let end = from === "" || to === "" ? size - 1 : Number(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  start = Math.max(0, start);
  if (start > end || start >= size) return "invalid";
  end = Math.min(end, size - 1, start + RANGE_WINDOW_BYTES - 1);
  return { start, end };
}
