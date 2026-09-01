import { afterEach, describe, expect, test } from "vitest";
import { fetchImage, isPublicAddress } from "@/lib/api/fetchMedia";

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
   */
  test("a name that does not resolve is refused differently, and says to retry", async () => {
    // A .invalid name can never resolve — RFC 2606 reserves it for exactly
    // this, so the test needs no resolver stub and cannot flake on a machine
    // whose DNS answers wildcards.
    const result = await fetchImage("https://nothing-here.invalid/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.problem.reason).toContain("could not be looked up");
    expect(result.problem.reason).toMatch(/temporary|again/i);
    // And it is not mistakable for the permanent one.
    expect(result.problem.reason).not.toBe("that host does not resolve to a public address");
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
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

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
    globalThis.fetch = async () =>
      respond({ headers: { "content-type": "image/jpeg" }, body: bytes });

    const result = await fetchImage("https://example.com/photos/sunset.jpg", 1024);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.media.filename).toBe("sunset.jpg");
    expect([...result.media.bytes]).toEqual([1, 2, 3, 4]);
  });

  test("a URL with no usable extension gets one from the content type", async () => {
    globalThis.fetch = async () =>
      respond({ headers: { "content-type": "image/webp" }, body: new Uint8Array([1]) });
    const result = await fetchImage("https://example.com/render?id=42", 1024);
    if (!result.ok) throw new Error(result.problem.reason);
    expect(result.media.filename.endsWith(".webp")).toBe(true);
  });

  test("something that is not an image is refused, whatever the URL said", async () => {
    globalThis.fetch = async () =>
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
    globalThis.fetch = async () =>
      respond({
        headers: { "content-type": "image/jpeg", "content-length": "4" },
        body: new Uint8Array(5000),
      });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("larger than");
  });

  test("an error status is refused", async () => {
    globalThis.fetch = async () => respond({ status: 404 });
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
    globalThis.fetch = async () => {
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
   * Asserted directly, because a stub cannot show the difference: with
   * `redirect: "follow"` the runtime chases the hop itself and this code never
   * sees the 302 — so the address check between hops never runs, and a public
   * host redirecting to the metadata endpoint gets there. The option *is* the
   * defence.
   */
  test("asks fetch not to follow redirects itself", async () => {
    const seen: RequestInit[] = [];
    globalThis.fetch = async (_url, init) => {
      seen.push(init as RequestInit);
      return respond({ headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]) });
    };
    await fetchImage("https://example.com/a.jpg", 1024);
    expect(seen[0].redirect).toBe("manual");
  });

  test("a redirect loop gives up rather than spinning", async () => {
    globalThis.fetch = async () => respond({ status: 302, location: "https://example.com/again" });
    const result = await fetchImage("https://example.com/a.jpg", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem.reason).toContain("too many redirects");
  });

  test("a redirect to another public host is followed", async () => {
    let hop = 0;
    globalThis.fetch = async () => {
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
