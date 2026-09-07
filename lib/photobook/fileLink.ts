import crypto from "node:crypto";
import { accessSecret } from "../access";

/**
 * A link to one book file that carries its own permission.
 *
 * Gelato accepts no upload — it fetches the interior and cover PDFs from a URL
 * given in the order — and the owner-cookie route those files sit behind is
 * one no printer can get past. So this signs a URL instead: the same file, the
 * same route, reachable for a day by whoever holds the link.
 *
 * That is a real trade and is stated rather than buried. For those hours the
 * book is readable by anyone with the link, which is the trade the postcard
 * preview URL already makes. What it is not is guessable: the signature covers
 * the journal, the order, the file *and* the expiry, so none of the four can
 * be moved without invalidating it.
 *
 * A day rather than an hour because Gelato retries its own fetch, and a link
 * that expired between submit and retry fails an order that was paid for.
 */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function mac(owner: string, id: string, file: string, exp: string): string {
  return crypto
    .createHmac("sha256", accessSecret())
    .update(`photobook-file:${owner}:${id}:${file}:${exp}`)
    .digest("hex");
}

export function signFileLink(owner: string, id: string, file: string, ttlMs = DEFAULT_TTL_MS): string {
  const exp = String(Date.now() + ttlMs);
  return `?exp=${exp}&sig=${mac(owner, id, file, exp)}`;
}

export function verifyFileLink(
  owner: string,
  id: string,
  file: string,
  exp: string | null,
  sig: string | null,
  now = Date.now(),
): boolean {
  if (!exp || !sig) return false;
  const expiry = Number(exp);
  if (!Number.isFinite(expiry) || expiry < now) return false;
  const expected = mac(owner, id, file, exp);
  // Lengths differ only if the query was mangled; timingSafeEqual throws on
  // a mismatch rather than answering, so the length check comes first.
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
