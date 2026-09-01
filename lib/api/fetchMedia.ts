import "server-only";
import dns from "node:dns/promises";
import net from "node:net";

/**
 * Downloading a photograph an agent points at, rather than one it uploads.
 *
 * The convenient case is real: an agent that has just produced an image, or is
 * looking at one somewhere public, would otherwise have to base64 it through
 * the protocol. The dangerous case is the same feature. This is a **server
 * making an HTTP request to an address a third party chose**, which is the
 * definition of SSRF, and this server sits inside somebody's network, next to
 * a database, and on cloud providers next to a metadata endpoint that hands
 * out credentials to anything that asks.
 *
 * So the rules here are deliberately unhelpful:
 *
 * - **https only.** No http, no file:, no gopher:, no data:.
 * - **Every resolved address must be public.** Checked after DNS resolution
 *   and again after every redirect, because a name that resolved publicly a
 *   moment ago can resolve to 127.0.0.1 on the next lookup — the DNS-rebinding
 *   attack this ordering exists to defeat.
 * - **Redirects are followed by hand**, at most three, so each hop is
 *   re-checked rather than trusted to `fetch`.
 * - **A declared image content type**, and a size cap enforced while reading
 *   rather than from the Content-Length header, which is a claim.
 * - **A short timeout.** A fetch that hangs is a request holding a connection.
 *
 * Nothing here reads a credential, so nothing here can leak one directly. The
 * risk being managed is the server's *position*, not its secrets.
 */

/** Long enough for a slow CDN, short enough not to be a resource to hold. */
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

export type FetchedMedia = { filename: string; bytes: Buffer };

export type FetchProblem = { url: string; reason: string };

/**
 * Whether an IP is one this server may talk to.
 *
 * Everything private, loopback, link-local, multicast or otherwise reserved is
 * refused — including IPv4-mapped IPv6, which is how `::ffff:127.0.0.1` sneaks
 * a loopback address past a naive v6 check.
 */
export function isPublicAddress(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 0) return false;

  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, and AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a >= 224) return false; // multicast and reserved
    return true;
  }

  const lower = ip.toLowerCase();
  /**
   * An IPv4 address wearing a v6 costume still goes wherever the v4 goes —
   * **in either spelling**.
   *
   * The dotted form is what a person writes. The hex form is what they get:
   * `new URL("https://[::ffff:127.0.0.1]/…").hostname` normalises to
   * `[::ffff:7f00:1]`, and `169.254.169.254` — the cloud metadata address this
   * check exists for — becomes `::ffff:a9fe:a9fe`. Only the dotted form was
   * matched, so the hex form fell past every branch below and returned
   * `true`.
   *
   * It was masked until now by a second bug rather than by anything
   * deliberate: `hostname` keeps its brackets, `net.isIP("[…]")` is 0, and the
   * DNS lookup that followed threw and refused the URL. Fixing the brackets
   * removed that accident, which is how this surfaced.
   */
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (dotted) return isPublicAddress(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hex) {
    const high = Number.parseInt(hex[1], 16);
    const low = Number.parseInt(hex[2], 16);
    return isPublicAddress(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join("."),
    );
  }
  if (lower === "::" || lower === "::1") return false;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return false; // unique-local
  if (lower.startsWith("fe80")) return false; // link-local
  if (lower.startsWith("ff")) return false; // multicast
  return true;
}

/**
 * The three answers a hostname check can have, kept apart.
 *
 * `private` and `unresolvable` used to be the same `false`, and so shared one
 * refusal — "that host does not resolve to a public address". For a genuinely
 * private address that wording is exactly right and must not change: a prober
 * does not get to map somebody's network one hostname at a time, so every
 * private answer has to read alike.
 *
 * But a resolver that timed out is not that. It means *try again*, and an
 * agent told the host "does not resolve to a public address" reads it as
 * permanent, drops the image and reports to the person that their photo host
 * is blocked. The all-or-nothing batch rule makes it louder: one flaky lookup
 * discards a whole upload, explained in words that say resending is pointless.
 *
 * So the distinction exposed is permanent-versus-transient, and nothing more.
 * Which range, which resolver and how it failed stay unsaid.
 */
type HostVerdict = "public" | "private" | "unresolvable";

async function checkHost(hostname: string): Promise<HostVerdict> {
  /**
   * A literal address never reaches DNS; check it directly. It can never be
   * "unresolvable" — there was nothing to resolve.
   *
   * The brackets come off first. `new URL("https://[::1]/a.jpg").hostname` is
   * `"[::1]"`, which `net.isIP` does not recognise, so every IPv6 literal used
   * to fall through to `dns.lookup("[::1]")` — which throws, which returned
   * `false`, which happened to produce the right refusal. It was never
   * actually checked as an address. Splitting the DNS failure out of the
   * private answer is what made that visible: `[::1]` started reading as
   * "try again", which is the wrong thing to tell somebody probing for
   * loopback.
   */
  const literal = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (net.isIP(literal)) return isPublicAddress(literal) ? "public" : "private";

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    return "unresolvable";
  }
  // No answers at all is a name that does not exist, which is the caller's
  // mistake rather than a reason to retry — but it is also not evidence about
  // anybody's private network, so it reads as unresolvable rather than as
  // private.
  if (addresses.length === 0) return "unresolvable";
  return addresses.every((a) => isPublicAddress(a.address)) ? "public" : "private";
}

function filenameFrom(url: URL, contentType: string): string {
  const last = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (/\.(jpe?g|png|heic|heif|webp)$/i.test(last)) return last;
  const extension =
    /png/.test(contentType) ? ".png"
    : /webp/.test(contentType) ? ".webp"
    : /hei[cf]/.test(contentType) ? ".heic"
    : ".jpg";
  return `${last.replace(/[^a-zA-Z0-9._-]/g, "") || "image"}${extension}`;
}

/**
 * Downloads one image, or explains why it will not.
 *
 * `maxBytes` is enforced while the body is read: `Content-Length` is a claim
 * by the same party that chose the URL, and a server that trusts it can be
 * handed a gigabyte by an endpoint that said 10 KB.
 */
export async function fetchImage(
  raw: string,
  maxBytes: number,
): Promise<{ ok: true; media: FetchedMedia } | { ok: false; problem: FetchProblem }> {
  const refuse = (reason: string) => ({ ok: false as const, problem: { url: raw, reason } });

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("not a URL");
  }
  if (url.protocol !== "https:") {
    return refuse("only https: URLs are fetched — http, file and data are refused");
  }

  let response: Response;
  let hops = 0;
  for (;;) {
    const verdict = await checkHost(url.hostname);
    if (verdict === "private") {
      // Same words whichever private range it was: a prober does not get to
      // map somebody's network one hostname at a time.
      return refuse("that host does not resolve to a public address");
    }
    if (verdict === "unresolvable") {
      // Deliberately different words, and they say what to do. See `checkHost`.
      return refuse(
        "could not be looked up — the name did not resolve. This may be temporary; " +
          "send the batch again. It is not a refusal for pointing somewhere private",
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*" },
      });
    } catch {
      return refuse("could not be reached");
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return refuse("redirected to nowhere");
      if (++hops > MAX_REDIRECTS) return refuse("too many redirects");
      try {
        url = new URL(location, url);
      } catch {
        return refuse("redirected to something that is not a URL");
      }
      // Round again — and note the address check happens before the next
      // request, not once at the start. That is the whole point of doing this
      // by hand instead of letting fetch follow.
      continue;
    }
    break;
  }

  if (!response.ok) return refuse(`answered ${response.status}`);

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("image/")) {
    return refuse(`is ${contentType || "of unknown type"}, not an image`);
  }

  const reader = response.body?.getReader();
  if (!reader) return refuse("sent no body");
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return refuse(`is larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB`);
    }
    chunks.push(Buffer.from(value));
  }

  return { ok: true, media: { filename: filenameFrom(url, contentType), bytes: Buffer.concat(chunks) } };
}
