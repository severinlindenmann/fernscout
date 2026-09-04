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

/**
 * How long the body may take to arrive, once the headers have.
 *
 * `TIMEOUT_MS` covers reaching the host and getting a response — it is cleared
 * the moment `fetch()` resolves, which is before a single byte of image has
 * been read. Until B136 nothing bounded the read itself, so a caller-chosen
 * third party decided how long this server held a connection and a request
 * handler: a host trickling 49 MB passes the byte cap, succeeds, and can take
 * as long as it likes doing it.
 *
 * 60 seconds against a 50 MB ceiling is about 875 KB/s sustained. A host
 * slower than that on a file that large is one this endpoint declines to wait
 * for, and the caller is told to try again rather than told it was refused.
 */
const BODY_TIMEOUT_MS = 60_000;

export type FetchedMedia = { filename: string; bytes: Buffer };

export type FetchProblem = { url: string; reason: string };

/**
 * One address, as the sixteen bytes it actually is.
 *
 * **This function is the whole fix for B36.** The checks below used to match
 * strings, and a string is a *spelling* rather than an address: `::1` and
 * `0:0:0:0:0:0:0:1` are the same machine and shared no prefix, `fe80::/10`
 * spans `fe80`–`febf` while only `fe80` was matched, and `::ffff:127.0.0.1`
 * arrives from `new URL()` normalised to `::ffff:7f00:1`. Every one of those
 * was reachable. Two of them had already been found and patched individually
 * (B31), which is what suggested that patching spellings was the wrong shape.
 *
 * Reduced to bytes there is nothing left to spell differently, so the ranges
 * below can be compared as the RFCs define them.
 *
 * v4 becomes v4-mapped — `::ffff:a.b.c.d` — so one set of range checks covers
 * both families and an IPv4 address cannot be private in one form and public
 * in another.
 */
function toBytes(ip: string): Uint8Array | null {
  const version = net.isIP(ip);
  if (version === 0) return null;

  const bytes = new Uint8Array(16);
  if (version === 4) {
    // ::ffff:a.b.c.d — the mapped form, so the v4 branch below catches it.
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    ip.split(".").forEach((part, i) => (bytes[12 + i] = Number(part)));
    return bytes;
  }

  // The tail may be dotted-quad: `::ffff:127.0.0.1`, `64:ff9b::192.0.2.1`.
  let text = ip.toLowerCase();
  const dotted = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const quad = dotted[1].split(".").map(Number);
    const high = ((quad[0] << 8) | quad[1]).toString(16);
    const low = ((quad[2] << 8) | quad[3]).toString(16);
    text = `${text.slice(0, dotted.index)}:${high}:${low}`;
  }

  // `::` stands for however many zero groups are needed to reach eight.
  const [head, tail] = text.split("::");
  const left = head ? head.split(":").filter(Boolean) : [];
  const right = tail !== undefined && tail ? tail.split(":").filter(Boolean) : [];
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  if (groups.length !== 8) return null;

  groups.forEach((group, i) => {
    const value = Number.parseInt(group, 16);
    bytes[i * 2] = value >> 8;
    bytes[i * 2 + 1] = value & 0xff;
  });
  return bytes;
}

/** True when the first `bits` of the address equal `prefix`. */
function inRange(bytes: Uint8Array, prefix: number[], bits: number): boolean {
  for (let i = 0; i < bits; i++) {
    const bit = (n: number) => (n >> (7 - (i % 8))) & 1;
    if (bit(bytes[i >> 3]) !== bit(prefix[i >> 3] ?? 0)) return false;
  }
  return true;
}

/** The v4 rules, on the last four bytes of a mapped address. */
function isPublicV4(b: Uint8Array): boolean {
  const [a, second] = [b[12], b[13]];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 169 && second === 254) return false; // link-local, and AWS metadata
  if (a === 172 && second >= 16 && second <= 31) return false;
  if (a === 192 && second === 168) return false;
  if (a === 100 && second >= 64 && second <= 127) return false; // carrier-grade NAT
  if (a >= 224) return false; // multicast and reserved
  return true;
}

/**
 * Whether an IP is one this server may talk to.
 *
 * Everything private, loopback, link-local, multicast or otherwise reserved is
 * refused. Compared as bytes, not as text — see `toBytes` for why that
 * distinction is the entire point of this function.
 */
export function isPublicAddress(ip: string): boolean {
  const b = toBytes(ip);
  if (!b) return false;

  // v4-mapped `::ffff:0:0/96`. Covers every IPv4 address, in either family.
  if (inRange(b, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff], 96)) return isPublicV4(b);

  /**
   * NAT64 — `64:ff9b::/96` — carries an IPv4 address in its last four bytes
   * and is routed to it. It was not checked at all, so `64:ff9b::a9fe:a9fe`
   * reached the metadata endpoint by a different door than `::ffff:a9fe:a9fe`
   * did. Judged on what it embeds, for the same reason the mapped form is.
   */
  if (inRange(b, [0x00, 0x64, 0xff, 0x9b], 96)) return isPublicV4(b);

  /**
   * `::` and `::1`, and every way of writing them. These were exact string
   * comparisons, so `0:0:0:0:0:0:0:1` — which `net.isIP` accepts and which is
   * the same loopback — was public.
   */
  if (b.every((byte) => byte === 0)) return false;
  if (b.slice(0, 15).every((byte) => byte === 0) && b[15] === 1) return false;

  // ::a.b.c.d, the deprecated v4-compatible form. Still routes to the v4.
  if (b.slice(0, 12).every((byte) => byte === 0)) return isPublicV4(b);

  if (inRange(b, [0xfc], 7)) return false; // unique-local fc00::/7
  /**
   * Link-local is `fe80::/10`, which spans `fe80` through `febf`. The old
   * check was `startsWith("fe80")`, so `fe90::1` and `feb0::1` — both
   * link-local — were public.
   */
  if (inRange(b, [0xfe, 0x80], 10)) return false;
  if (inRange(b, [0xfe, 0xc0], 10)) return false; // site-local, deprecated but not routable
  if (inRange(b, [0xff], 8)) return false; // multicast

  return true;
}

/**
 * The four answers a hostname check can have, kept apart.
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
 * B31 split those two and stopped there, which left the opposite mistake:
 * **a name that does not exist was told to try again.** A typo is permanent,
 * and an agent that believes "this may be temporary" resends it forever. So
 * `nonexistent` is now its own answer. Telling it apart from a resolver that
 * did not answer leaks nothing — "there is no such name" says nothing about
 * anybody's network, which is the property the uniform private wording exists
 * to protect (B137).
 *
 * So the distinction exposed is permanent-versus-transient, and nothing more.
 * Which range, which resolver and how it failed stay unsaid.
 */
type HostVerdict = "public" | "private" | "unresolvable" | "nonexistent";

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
  } catch (err) {
    // `getaddrinfo` distinguishes "the resolver answered, and there is no such
    // name" from "the resolver did not answer", and the two mean opposite
    // things to the caller. ENOTFOUND is NXDOMAIN or a name with no address
    // records; EAI_NONAME is the same answer under a different libc. Anything
    // else — EAI_AGAIN above all — is a resolver that failed, not a name that
    // is wrong.
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOTFOUND" || code === "EAI_NONAME" ? "nonexistent" : "unresolvable";
  }
  // No answers at all is a name that does not exist, which is the caller's
  // mistake rather than a reason to retry — and it is not evidence about
  // anybody's private network either, so it reads as nonexistent rather than
  // as private.
  if (addresses.length === 0) return "nonexistent";
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
 * handed a gigabyte by an endpoint that said 10 KB. An *overstated* header is
 * still worth acting on — refusing before reading anything is free whenever it
 * is honest — but it is a shortcut to the same answer, never the check itself.
 *
 * Two clocks, because they bound different things (B136): `TIMEOUT_MS` to get
 * a response at all, and `bodyTimeoutMs` for the body that follows it.
 */
export async function fetchImage(
  raw: string,
  maxBytes: number,
  /** Overridable so a test can assert the budget without waiting a minute for
   * it. Nothing in the application passes it. */
  bodyTimeoutMs: number = BODY_TIMEOUT_MS,
  /** The other clock, overridable for the same reason. */
  responseTimeoutMs: number = TIMEOUT_MS,
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
  // Declared out here so the body read below can abort the request that
  // produced it. A controller scoped to the loop could only ever cancel the
  // reader, which drops our end and leaves the connection to time out on its
  // own schedule rather than ours.
  let controller!: AbortController;
  let hops = 0;
  for (;;) {
    const verdict = await checkHost(url.hostname);
    if (verdict === "private") {
      // Same words whichever private range it was: a prober does not get to
      // map somebody's network one hostname at a time.
      return refuse("that host does not resolve to a public address");
    }
    if (verdict === "nonexistent") {
      // Permanent, and says so. No invitation to retry: the retry is what an
      // agent does forever with a typo. Says nothing about any network.
      return refuse(
        "could not be looked up — there is no such name. That is permanent, so check " +
          "the spelling rather than resending. It is not a refusal for pointing somewhere " +
          "private",
      );
    }
    if (verdict === "unresolvable") {
      // Deliberately different words, and they say what to do. See `checkHost`.
      return refuse(
        "could not be looked up — the name did not resolve. This may be temporary; " +
          "send the batch again. It is not a refusal for pointing somewhere private",
      );
    }

    controller = new AbortController();
    // Which of the two it was matters to the caller: a host that took too long
    // to answer is as transient as a resolver that did not, and until B137 it
    // was the one transient case with no retry-shaped wording at all. A
    // connection that was refused outright keeps the neutral answer.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, responseTimeoutMs);
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { accept: "image/*" },
      });
    } catch {
      if (timedOut) {
        return refuse(
          `took longer than ${(responseTimeoutMs / 1000).toFixed(0)} seconds to answer — ` +
            "this may be temporary; send the batch again",
        );
      }
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

  const tooBig = () => refuse(`is larger than ${(maxBytes / 1024 / 1024).toFixed(0)} MB`);

  // A header that admits to being over the limit is taken at its word, because
  // the only way it can be wrong is in our favour: a host that overstates gets
  // refused something it was not going to be allowed to send anyway. An
  // understated one buys nothing — the loop below is still the real check.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    return tooBig();
  }

  const reader = response.body?.getReader();
  if (!reader) return refuse("sent no body");

  // One deadline for the whole read, raced against each chunk. A check between
  // chunks would not help: the case that costs the most is a host that stops
  // sending entirely, and `read()` on a stalled body simply never settles.
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<"timeout">((resolve) => {
    budgetTimer = setTimeout(() => resolve("timeout"), bodyTimeoutMs);
  });

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), budget]);
      if (next === "timeout") {
        // Abort first, cancel second: the abort is what actually lets go of
        // the socket, and the cancel is only tidying up our reader.
        controller.abort();
        await reader.cancel().catch(() => {});
        return refuse(
          `took longer than ${(bodyTimeoutMs / 1000).toFixed(0)} seconds to send its body — ` +
            "this may be temporary; send the batch again",
        );
      }
      const { done, value } = next;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort();
        await reader.cancel().catch(() => {});
        return tooBig();
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    // A body that fails partway through is the same answer as one that never
    // started, and for the same reason: we have no image and the caller may
    // reasonably try again.
    return refuse("could not be reached");
  } finally {
    clearTimeout(budgetTimer);
  }

  return { ok: true, media: { filename: filenameFrom(url, contentType), bytes: Buffer.concat(chunks) } };
}
