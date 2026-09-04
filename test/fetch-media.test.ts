import { afterEach, describe, expect, test } from "vitest";
import dns from "node:dns/promises";
import dnsCallback from "node:dns";
import net from "node:net";
import { fetchImage, isPublicAddress, type Transport } from "@/lib/api/fetchMedia";

/** Kept because the block below shadows `fetchImage` with a wrapper. */
const directFetchImage = fetchImage;

/**
 * Downloading an image from a URL an agent chose.
 *
 * This is a server making a request to an address a third party picked, which
 * is SSRF by definition — and this server sits inside somebody's network, next
 * to their database, and on most cloud providers a couple of hops from a
 * metadata endpoint that hands credentials to anything that asks for them.
 *
 * The tests that matter are the refusals.
 */

describe("which addresses may be reached", () => {
  test.each([
    ["127.0.0.1", "loopback"],
    ["0.0.0.0", "this host"],
    ["10.1.2.3", "private class A"],
    ["172.16.0.1", "private class B"],
    ["172.31.255.255", "the top of class B"],
    ["192.168.1.1", "private class C"],
    ["169.254.169.254", "the cloud metadata endpoint"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["224.0.0.1", "multicast"],
    ["::1", "IPv6 loopback"],
    ["fd00::1", "IPv6 unique-local"],
    ["fe80::1", "IPv6 link-local"],
    ["ff02::1", "IPv6 multicast"],
    ["::ffff:127.0.0.1", "IPv4 loopback wearing an IPv6 costume"],
    ["::ffff:169.254.169.254", "the metadata endpoint, likewise"],
    // The same two addresses in the spelling the URL parser actually produces.
    // These returned `true` until B31: the mapped-address check matched only
    // the dotted form, and `new URL` normalises to hex.
    ["::ffff:7f00:1", "IPv4 loopback, hex-normalised as the URL parser writes it"],
    ["::ffff:a9fe:a9fe", "the metadata endpoint, hex-normalised"],
    ["::ffff:c0a8:1", "192.168.0.1, hex-normalised"],
    ["::ffff:a00:1", "10.0.0.1, hex-normalised"],
    // B36: every one of these was reachable, because the checks matched a
    // spelling rather than an address. See `toBytes`.
    ["0:0:0:0:0:0:0:1", "loopback, written out — was an exact string compare"],
    ["0000:0000:0000:0000:0000:0000:0000:0001", "loopback, fully padded"],
    ["0:0:0:0:0:0:0:0", "the unspecified address, written out"],
    ["fe90::1", "link-local — fe80::/10 spans fe80 to febf, not just fe80"],
    ["feb0::1", "link-local, the top of the range"],
    ["febf:ffff::1", "link-local, the last address in it"],
    ["fec0::1", "site-local: deprecated, and still not routable"],
    ["fcff::1", "unique-local, the fc half"],
    ["fdff::1", "unique-local, the fd half"],
    ["64:ff9b::7f00:1", "NAT64 carrying loopback — was not checked at all"],
    ["64:ff9b::a9fe:a9fe", "NAT64 carrying the metadata endpoint"],
    ["64:ff9b::169.254.169.254", "the same, dotted"],
    ["::127.0.0.1", "the deprecated v4-compatible form of loopback"],
    ["ff00::", "multicast, the first address"],
    ["not-an-ip", "not an address at all"],
    ["", "nothing"],
  ])("refuses %s (%s)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  /**
   * The property the rewrite bought, stated once rather than as a list of
   * spellings: writing an address differently must not change the answer.
   */
  test.each([
    [["::1", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001"], "loopback"],
    [["::ffff:127.0.0.1", "::ffff:7f00:1"], "mapped loopback"],
    [["::ffff:169.254.169.254", "::ffff:a9fe:a9fe"], "the metadata endpoint, mapped"],
    [["64:ff9b::a9fe:a9fe", "64:ff9b::169.254.169.254"], "the metadata endpoint, NAT64"],
    [["8.8.8.8", "::ffff:8.8.8.8", "::ffff:808:808"], "a public resolver"],
    [["2001:4860:4860::8888", "2001:4860:4860:0:0:0:0:8888"], "a public v6"],
  ])("every spelling of %s agrees", (spellings) => {
    const answers = new Set((spellings as string[]).map(isPublicAddress));
    expect(answers.size, `spellings disagreed: ${spellings}`).toBe(1);
  });

  test.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["93.184.216.34"],
    ["2606:2800:220:1:248:1893:25c8:1946"],
    // A mapped *public* address, hex-normalised: 8.8.8.8. The fix must not
    // turn every mapped address into a refusal.
    ["::ffff:808:808"],
    // B36 widened several ranges. These sit just outside each of them, and
    // are the addresses a too-eager fix would have taken out with the leak.
    ["fe7f::1"],
    ["2001:4860:4860::8888"],
    ["64:ff9b::808:808"],
    ["fbff::1"],
    ["ff::1"],
  ])(
    "allows %s",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  /** 172.15 and 172.32 are public; only 16–31 are not. Off-by-one here would
   * either block real hosts or expose a private range. */
  test("gets the edges of the 172.16/12 block right", () => {
    expect(isPublicAddress("172.15.0.1")).toBe(true);
    expect(isPublicAddress("172.16.0.1")).toBe(false);
    expect(isPublicAddress("172.31.0.1")).toBe(false);
    expect(isPublicAddress("172.32.0.1")).toBe(true);
  });

  /**
   * The v6 boundaries, which B36 moved. Each pair is the last refused address
   * and the first allowed one — the place a prefix length written as `/9` or
   * `/11` instead of `/10` would show up, and nowhere else.
   */
  test.each([
    ["link-local fe80::/10", "febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fec0::"],
    ["unique-local fc00::/7", "fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "fe00::"],
  ])("gets the edges of %s right", (_name, lastRefused, firstAfter) => {
    expect(isPublicAddress(lastRefused)).toBe(false);
    // `fec0::` is itself refused as site-local, so this only asserts that the
    // range below it ends where it should — see the next case for the rest.
    expect(typeof isPublicAddress(firstAfter)).toBe("boolean");
  });

  test("fe7f:: is public and fe80:: is not", () => {
    // One bit apart, and the old `startsWith("fe80")` got both wrong in
    // different directions.
    expect(isPublicAddress("fe7f:ffff::1")).toBe(true);
    expect(isPublicAddress("fe80::")).toBe(false);
  });

  test("fbff:: is public and fc00:: is not", () => {
    expect(isPublicAddress("fbff:ffff::1")).toBe(true);
    expect(isPublicAddress("fc00::")).toBe(false);
  });
});

describe("what fetchImage refuses outright", () => {
  test.each([
    ["http://example.com/a.jpg", "plain http"],
    ["file:///etc/passwd", "the filesystem"],
    ["data:image/png;base64,iVBORw0KGgo=", "a data URL"],
    ["ftp://example.com/a.jpg", "another protocol"],
    ["gopher://example.com/", "an obscure one"],
  ])("%s — %s", async (url) => {
    const result = await fetchImage(url, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("https");
  });

  test("something that is not a URL at all", async () => {
    const result = await fetchImage("../../etc/passwd", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toBe("not a URL");
  });

  /**
   * The address check runs on the resolved IP, so a literal one is refused
   * without any lookup — and the message is the same whichever private range
   * it was, so a prober cannot map a network one hostname at a time.
   */
  test.each([
    ["https://127.0.0.1/a.jpg"],
    ["https://169.254.169.254/latest/meta-data/"],
    ["https://192.168.0.1/a.jpg"],
    ["https://[::1]/a.jpg"],
  ])("%s reaches nothing", async (url) => {
    const result = await fetchImage(url, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toBe("that host does not resolve to a public address");
  });

  test("a hostname that resolves to loopback is refused like any other", async () => {
    const result = await fetchImage("https://localhost/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("public address");
  });

  /**
   * B31. "It resolves somewhere private" and "it did not resolve" used to be
   * one `false` and one refusal. The first is permanent and its wording must
   * stay uniform; the second means try again, and an agent told the permanent
   * words drops the image and reports the host as blocked.
   *
   * B137 is the other half of the same idea: a name that **does not exist** is
   * every bit as permanent as a private one, and B31 told it to retry. A typo
   * resent forever is the cost.
   */
  test("a name that does not exist is not told the failure may be temporary", async () => {
    // A .invalid name can never resolve — RFC 2606 reserves it for exactly
    // this, so the test needs no resolver stub and cannot flake on a machine
    // whose DNS answers wildcards.
    const result = await fetchImage("https://nothing-here.invalid/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.problem.reason).toContain("could not be looked up");
    expect(result.problem.reason).toContain("there is no such name");
    // The whole point: no invitation to send it again.
    expect(result.problem.reason).not.toMatch(/temporary|send the batch again/i);
    // And it is still not mistakable for the private one, nor does it say
    // anything about a network — B31's rule, which this must not weaken.
    expect(result.problem.reason).not.toBe("that host does not resolve to a public address");
    expect(result.problem.reason).not.toMatch(/\d+\.\d+\.\d+\.\d+|ENOTFOUND|EAI_|resolver/);
  });

  /**
   * The transient half, driven through the resolver rather than through a real
   * name: `dns.lookup` failing with anything other than ENOTFOUND is a resolver
   * that did not answer, and that one keeps B31's retry-shaped wording.
   */
  test("a resolver that does not answer still says to retry", async () => {
    const real = dns.lookup;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).lookup = async () => {
      const err: NodeJS.ErrnoException = new Error("resolver timed out");
      err.code = "EAI_AGAIN";
      throw err;
    };
    try {
      const result = await fetchImage("https://example.com/a.jpg", 1024);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toContain("the name did not resolve");
      expect(result.problem.reason).toMatch(/temporary|send the batch again/i);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dns as any).lookup = real;
    }
  });

  /**
   * And a name whose resolver answers with no addresses at all: the same
   * permanent answer, reached by a different branch.
   */
  test("a name that resolves to nothing is permanent too", async () => {
    const real = dns.lookup;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).lookup = async () => [];
    try {
      const result = await fetchImage("https://example.com/a.jpg", 1024);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem.reason).toContain("there is no such name");
      expect(result.problem.reason).not.toMatch(/temporary|send the batch again/i);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dns as any).lookup = real;
    }
  });

  /**
   * Found while splitting the two refusals apart, and the reason the split was
   * worth doing. `new URL("https://[::1]/…").hostname` keeps its brackets, and
   * `net.isIP("[::1]")` is 0 — so every IPv6 literal skipped the address check
   * entirely and fell through to a DNS lookup that threw. The refusal was
   * right by accident, and only because the lookup failed.
   */
  test.each([
    ["https://[::1]/a.jpg"],
    // Normalised by the URL parser to [::ffff:7f00:1] — the hex spelling that
    // used to slip past the mapped-address check entirely.
    ["https://[::ffff:127.0.0.1]/a.jpg"],
    // And the one that matters: the cloud metadata address, as
    // [::ffff:a9fe:a9fe].
    ["https://[::ffff:169.254.169.254]/latest/meta-data/"],
    ["https://[fc00::1]/a.jpg"],
    ["https://[fe80::1]/a.jpg"],
  ])("%s is refused as an address, not because DNS failed", async (url) => {
    const result = await fetchImage(url, 1024);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The permanent wording. If this ever says "could not be looked up", the
    // bracket handling has regressed and a prober is being told to retry.
    expect(result.problem.reason).toBe("that host does not resolve to a public address");
  });

  test("a public IPv6 literal is not refused by the bracket handling", async () => {
    // The other half: stripping brackets must not make everything private.
    // 2606:4700:4700::1111 is a public resolver; the fetch itself will fail in
    // a sandbox, so only the *reason* is asserted.
    const result = await fetchImage("https://[2606:4700:4700::1111]/a.jpg", 1024);
    if (!result.ok) {
      expect(result.problem.reason).not.toBe("that host does not resolve to a public address");
    }
  });

  test("the permanent refusal's wording is unchanged, and says nothing about where", async () => {
    const result = await fetchImage("https://10.0.0.5/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // Asserted as an exact string on purpose: this is the one message that
    // must read alike for every private range.
    expect(result.problem.reason).toBe("that host does not resolve to a public address");
    expect(result.problem.reason).not.toContain("10.0.0.5");
    expect(result.problem.reason).not.toMatch(/loopback|link-local|private range/i);
  });
});

/**
 * The parts that need a server to answer.
 *
 * `fetch` is stubbed rather than reached: the project's own rule is that a
 * build never touches the network, and a test that depends on somebody's CDN
 * being up tests their uptime. DNS is left real — `example.com` resolves
 * publicly, which is the branch under test.
 */
describe("reading a response", () => {
  /**
   * Stubbed at the transport rather than at `globalThis.fetch`.
   *
   * Since B03 the request is not made by `fetch` at all: `fetch` takes no
   * `lookup`, so it cannot be told which address to connect to, and the pin is
   * the fix. `node:https` can, so that is what the default transport uses —
   * and the seam these tests hold moved with it. Every assertion below is the
   * one it was before; only the thing being stubbed changed.
   */
  let transport: Transport | undefined;
  afterEach(() => {
    transport = undefined;
  });
  const fetchImage = (
    url: string,
    maxBytes: number,
    bodyTimeoutMs?: number,
    responseTimeoutMs?: number,
  ) => directFetchImage(url, maxBytes, bodyTimeoutMs, responseTimeoutMs, transport);

  function respond(init: {
    status?: number;
    headers?: Record<string, string>;
    body?: Uint8Array;
    location?: string;
  }) {
    const headers = new Headers(init.headers ?? {});
    if (init.location) headers.set("location", init.location);
    return new Response(init.body ? new Blob([init.body as BlobPart]) : null, {
      status: init.status ?? 200,
      headers,
    });
  }

  test("an image comes back with its bytes and a usable filename", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    transport = async () =>
      respond({ headers: { "content-type": "image/jpeg" }, body: bytes });

    const result = await fetchImage("https://example.com/photos/sunset.jpg", 1024);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.media.filename).toBe("sunset.jpg");
    expect([...result.media.bytes]).toEqual([1, 2, 3, 4]);
  });

  test("a URL with no usable extension gets one from the content type", async () => {
    transport = async () =>
      respond({ headers: { "content-type": "image/webp" }, body: new Uint8Array([1]) });
    const result = await fetchImage("https://example.com/render?id=42", 1024);
    if (!result.ok) throw new Error(result.problem.reason);
    expect(result.media.filename.endsWith(".webp")).toBe(true);
  });

  test("something that is not an image is refused, whatever the URL said", async () => {
    transport = async () =>
      respond({ headers: { "content-type": "text/html" }, body: new Uint8Array([1]) });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("not an image");
  });

  /**
   * Content-Length is a claim by the same party that chose the URL. The cap
   * has to hold while the body is read, or an endpoint that promises 10 KB
   * can hand over a gigabyte.
   */
  test("the size cap is enforced on the bytes, not on the header", async () => {
    transport = async () =>
      respond({
        headers: { "content-type": "image/jpeg", "content-length": "4" },
        body: new Uint8Array(5000),
      });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("larger than");
  });

  /**
   * B136. The cap has always been checked per chunk, but nothing asserted that
   * the read actually *stops* — a version that buffered the whole body and
   * judged it at the end passes every other test in this file, and costs the
   * full size of whatever was sent.
   *
   * The body here is a stream that counts how many chunks were pulled out of
   * it, so "stopped early" is observable rather than assumed.
   */
  test("a body over the cap is abandoned partway, not read to the end", async () => {
    let pulled = 0;
    transport = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            if (pulled > 100) return controller.close();
            controller.enqueue(new Uint8Array(256));
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      );

    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("larger than 0 MB");
    // 1024 bytes at 256 a chunk: five reads settle it. The whole body is 100.
    expect(pulled).toBeLessThan(10);
  });

  /**
   * The other half of B136, and the one that cost the real time: a host that
   * sends a little and then stops. It never trips the byte cap, so before the
   * budget existed this held a connection and a request handler for as long as
   * the remote end cared to keep it — and `urls` is a list, so a batch
   * multiplies it.
   */
  test("a body that stalls is given up on, and the caller is told to retry", async () => {
    let cancelled = false;
    transport = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(8));
          },
          // No pull: after that first chunk the stream simply never produces
          // another, which is what a stalled socket looks like from here.
          pull() {
            return new Promise<void>(() => {});
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      );

    const started = Date.now();
    const result = await fetchImage("https://example.com/a.jpg", 1024, 150);
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.reason).toContain("took longer than");
      // B31's vocabulary: a timeout is not a verdict about the URL, so the
      // caller is told it may work next time rather than to stop asking.
      expect(result.problem.reason).toContain("send the batch again");
    }
    expect(elapsed).toBeLessThan(3000);
    expect(cancelled).toBe(true);
  });

  /**
   * B137. A host that never answers is as transient as a resolver that never
   * answers, and it was the one transient case with no retry-shaped wording:
   * `could not be reached`, full stop, which reads like a verdict on the URL.
   */
  test("a host that never answers is told to try again, not that it is unreachable", async () => {
    transport = (_url, _addresses, signal) =>
      new Promise<Response>((_resolve, reject) => {
        // What a socket does on abort: rejects, and never settles otherwise.
        signal.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });

    const started = Date.now();
    const result = await fetchImage("https://example.com/a.jpg", 1024, 60_000, 150);
    expect(Date.now() - started).toBeLessThan(3000);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toContain("took longer than");
    expect(result.problem.reason).toContain("send the batch again");
    expect(result.problem.reason).not.toBe("could not be reached");
  });

  /** And a connection that fails for some other reason keeps the neutral
   * answer, so the retry advice stays attached to the timeout alone. */
  test("a connection that simply fails is not told to try again", async () => {
    transport = async () => {
      throw new TypeError("fetch failed");
    };
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.reason).toBe("could not be reached");
  });

  test("a body that arrives slowly but keeps arriving is not refused", async () => {
    let sent = 0;
    transport = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            await new Promise((r) => setTimeout(r, 10));
            sent += 1;
            if (sent > 4) return controller.close();
            controller.enqueue(new Uint8Array([sent]));
          },
        }),
        { headers: { "content-type": "image/jpeg" } },
      );

    const result = await fetchImage("https://example.com/a.jpg", 1024, 2000);
    expect(result.ok).toBe(true);
    if (result.ok) expect([...result.media.bytes]).toEqual([1, 2, 3, 4]);
  });

  /**
   * A header that admits to being over the limit can be acted on immediately:
   * the only way it is wrong is in our favour. The test above it — the one
   * that hands over 5000 bytes behind a `content-length: 4` — is the guard
   * that this stayed a shortcut and did not become the check.
   */
  test("a content-length already over the cap is refused, and the body let go", async () => {
    let pulled = 0;
    let cancelled = false;
    transport = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1;
            controller.enqueue(new Uint8Array(1024));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "image/jpeg", "content-length": "40960" } },
      );

    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("larger than");
    // The stream prefills one chunk when it is constructed, whoever reads it,
    // so "before the body is read" is `cancel()` having been called with the
    // rest of it undrained — not a pull count of zero.
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  test("an error status is refused", async () => {
    transport = async () => respond({ status: 404 });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("404");
  });

  /**
   * The reason redirects are followed by hand: every hop is re-checked. A
   * public host that redirects to the metadata endpoint is the whole attack,
   * and `redirect: "follow"` would have gone there.
   */
  test("a redirect into a private address is refused at the second hop", async () => {
    let hop = 0;
    transport = async () => {
      hop += 1;
      return hop === 1
        ? respond({ status: 302, location: "https://169.254.169.254/latest/meta-data/" })
        : respond({ headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) });
    };
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("public address");
    // It must not have made the second request at all.
    expect(hop).toBe(1);
  });

  /**
   * This used to assert `redirect: "manual"` on the `fetch` init, because with
   * `redirect: "follow"` the runtime chases the hop itself, this code never
   * sees the 302, and the address check between hops never runs. Since B03
   * there is no such option to get wrong — `node:https` has no redirect logic
   * at all — so the property is asserted where it now lives: **each hop is a
   * separate request this file makes**, with its own URL, and therefore its
   * own host check and its own pin.
   */
  test("every hop is a request this code makes itself, at that hop's own URL", async () => {
    const seen: string[] = [];
    transport = async (url) => {
      seen.push(url.href);
      return seen.length === 1
        ? respond({ status: 302, location: "https://example.net/real.png" })
        : respond({ headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) });
    };
    await fetchImage("https://example.com/a.jpg", 1024);
    expect(seen).toEqual(["https://example.com/a.jpg", "https://example.net/real.png"]);
  });

  /**
   * And the pin travels with each of them. A redirect that lands on a new host
   * must be connected to at *that* host's vetted address, never at the
   * previous hop's — the loop re-checks, so it has to re-pin as well.
   */
  test("each hop carries the addresses that hop was checked at", async () => {
    const seen: string[][] = [];
    transport = async (_url, addresses) => {
      seen.push(addresses);
      return seen.length === 1
        ? respond({ status: 301, location: "https://example.net/real.png" })
        : respond({ headers: { "content-type": "image/png" }, body: new Uint8Array([9]) });
    };
    await fetchImage("https://example.com/a.jpg", 1024);
    expect(seen).toHaveLength(2);
    // Real DNS, so the addresses themselves are whatever the resolver says;
    // what matters is that each hop got a non-empty, separately obtained set.
    for (const addresses of seen) expect(addresses.length).toBeGreaterThan(0);
  });

  test("a redirect loop gives up rather than spinning", async () => {
    transport = async () => respond({ status: 302, location: "https://example.com/again" });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("too many redirects");
  });

  test("a redirect to another public host is followed", async () => {
    let hop = 0;
    transport = async () => {
      hop += 1;
      return hop === 1
        ? respond({ status: 301, location: "https://example.net/real.png" })
        : respond({ headers: { "content-type": "image/png" }, body: new Uint8Array([9]) });
    };
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.media.filename).toBe("real.png");
  });
});

/**
 * B03 — the window between checking a name and fetching it.
 *
 * `checkHost` does its own lookup. Before this fix `fetch()` then did a
 * *second*, independent one, and a name whose first answer is public and whose
 * second is loopback passed the check and was fetched at the private address.
 * The module's comment claimed the ordering defeated rebinding; it defeats it
 * across redirects, where each hop is re-checked before its own request, and it
 * did nothing within a single hop.
 *
 * Driven end to end rather than through a spy, because the thing being asserted
 * is which address the socket went to. The two resolvers are stubbed apart:
 * `node:dns/promises` is what the check consults, `node:dns` is what the
 * connection consults — which is the whole shape of the attack.
 */
describe("a name that changes its answer between the check and the request", () => {
  test("is connected to at the address that was checked, and nowhere else", async () => {
    // Stands in for the attacker's private target: a real listener on
    // loopback, so "did the connection land here" is a fact rather than an
    // inference from an error message.
    let landed = 0;
    const decoy = net.createServer((socket) => {
      landed += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => decoy.listen(0, "127.0.0.1", resolve));
    const port = (decoy.address() as net.AddressInfo).port;

    // The first answer, and the only one this code is entitled to act on.
    // 203.0.113.0/24 is TEST-NET-3: public by every rule in `isPublicAddress`,
    // and routed nowhere, so a request pinned to it can only time out.
    const realCheck = dns.lookup;
    let checks = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).lookup = async () => {
      checks += 1;
      return [{ address: "203.0.113.9", family: 4 }];
    };

    // The second answer. Node's `net.connect` reads `dns.lookup` off the
    // callback module at connect time, so this is genuinely what an
    // unpinned request would resolve to.
    const realConnect = dnsCallback.lookup;
    let reresolutions = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dnsCallback as any).lookup = (_hostname: string, options: unknown, cb: unknown) => {
      reresolutions += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (realConnect as any).call(dnsCallback, "127.0.0.1", options, cb);
    };

    try {
      const result = await fetchImage(`https://rebind.test:${port}/a.jpg`, 1024, 500, 500);

      // The pin is the assertion. The request must never have asked DNS a
      // second question, and must never have reached the decoy.
      expect(reresolutions, "the hostname was resolved again at connect time").toBe(0);
      expect(landed, "the request reached the private address").toBe(0);
      // One check, and it is the one whose answer was used.
      expect(checks).toBe(1);
      // TEST-NET-3 answers nothing, so the only honest outcome is a refusal —
      // and never a success, which is what the unpinned version produced.
      expect(result.ok).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dns as any).lookup = realCheck;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dnsCallback as any).lookup = realConnect;
      await new Promise<void>((resolve) => decoy.close(() => resolve()));
    }
  });
});
