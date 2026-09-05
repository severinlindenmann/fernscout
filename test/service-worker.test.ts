import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * `public/sw.js` is plain JavaScript that nothing imports, so neither the
 * compiler nor the bundler ever looks at it. It is also the one piece of the
 * site that can keep serving a build that no longer exists, which makes it the
 * worst place in the project for an untested assumption.
 *
 * These tests run the file in a fake worker scope and ask one question of each
 * kind of request: does the worker answer it, or does it stand aside?
 */

type Handlers = Record<string, (event: unknown) => void>;

/** One thing sitting in the cache, as the worker will find it. */
type Cached = { url: string; type?: string; body?: string };

function fakeCaches(entries: Cached[]) {
  const held = entries.map((e) => ({
    url: e.url,
    response: new Response(e.body ?? e.url, {
      headers: { "content-type": e.type ?? "text/html; charset=utf-8" },
    }),
  }));
  const find = (url: string, ignoreSearch?: boolean) => {
    const want = new URL(url);
    return held.find((h) => {
      const got = new URL(h.url);
      return ignoreSearch
        ? got.pathname === want.pathname
        : got.pathname + got.search === want.pathname + want.search;
    });
  };
  const cache = {
    addAll: async () => {},
    put: async () => {},
    keys: async () => held.map((h) => ({ url: h.url })),
    match: async (key: { url: string }) => find(key.url)?.response.clone(),
  };

  /**
   * Named caches that actually store things — B412.
   *
   * The original fake answers every `open()` with one read-only cache, which
   * was enough while the worker only ever read. The personal cache is the
   * first thing it writes and then reads back under a name it computed, so
   * the name has to be real: a fake that ignored it would pass a worker that
   * served one reader's data to another.
   */
  const named = new Map<string, Map<string, Response>>();
  const openNamed = (name: string) => {
    let store = named.get(name);
    if (!store) {
      store = new Map();
      named.set(name, store);
    }
    const key = (k: { url: string } | string) => (typeof k === "string" ? k : k.url);
    return {
      addAll: async () => {},
      put: async (k: { url: string } | string, res: Response) => {
        store!.set(key(k), res);
      },
      keys: async () => [...store!.keys()].map((url) => ({ url })),
      match: async (k: { url: string } | string) => store!.get(key(k))?.clone(),
    };
  };

  return {
    named,
    match: async (request: { url: string } | string, options?: { ignoreSearch?: boolean }) => {
      const url = typeof request === "string" ? new URL(request, "https://journal.test").href : request.url;
      return find(url, options?.ignoreSearch)?.response.clone();
    },
    open: async (name?: string) =>
      name && name.startsWith("personal-") ? openNamed(name) : cache,
    keys: async () => [...named.keys()],
    delete: async (name: string) => named.delete(name),
  };
}

function loadWorker(
  cached: Cached[] = [],
  network: "ok" | "fail" | ((request: { url: string }) => Promise<Response>) = "ok",
) {
  const handlers: Handlers = {};
  const scope = {
    self: null as unknown,
    caches: fakeCaches(cached),
    fetch: async (request: { url: string }) => {
      if (typeof network === "function") return network(request);
      if (network === "fail") throw new Error("offline");
      return new Response("");
    },
    setTimeout,
    clearTimeout,
    Response,
    URL,
    Promise,
  };
  scope.self = {
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      handlers[name] = fn;
    },
    location: { origin: "https://journal.test" },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    registration: {},
  };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"), scope);
  return handlers;
}

/** The same, but keeping the fake cache store so a test can inspect it. */
function loadWorkerWithCaches(
  network: (request: { url: string }) => Promise<Response>,
): { handlers: Handlers; caches: ReturnType<typeof fakeCaches> } {
  const handlers: Handlers = {};
  const store = fakeCaches([]);
  const scope = {
    self: null as unknown,
    caches: store,
    fetch: async (request: { url: string }) => network(request),
    setTimeout,
    clearTimeout,
    Response,
    URL,
    Promise,
  };
  scope.self = {
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      handlers[name] = fn;
    },
    location: { origin: "https://journal.test" },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    registration: {},
  };
  vm.createContext(scope);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8"), scope);
  return { handlers, caches: store };
}

const HOME = "https://journal.test/api/v1/me/home";

/** Drive one request through the fetch handler and wait for the answer, plus
 * anything the worker asked to finish afterwards. */
async function run(
  handlers: Handlers,
  url: string,
): Promise<Response | undefined> {
  let answer: Promise<Response> | Response | undefined;
  const pending: Promise<unknown>[] = [];
  handlers.fetch({
    request: {
      url,
      method: "GET",
      mode: "cors",
      headers: { get: () => null },
    },
    respondWith: (r: Promise<Response> | Response) => {
      answer = r;
    },
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
  });
  const res = await answer;
  await Promise.all(pending);
  return res;
}

function homePayload(id: string) {
  return new Response(JSON.stringify({ id, email: "a@e.test", journals: [], devices: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Runs the fetch handler and reports whether the worker took the request. */
function handles(url: string, init: { mode?: string; method?: string; rsc?: boolean } = {}) {
  const handlers = loadWorker();
  let answered = false;
  handlers.fetch({
    request: {
      url,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
      headers: { get: (name: string) => (init.rsc && name === "RSC" ? "1" : null) },
    },
    respondWith: () => {
      answered = true;
    },
    waitUntil: () => {},
  });
  return answered;
}

describe("the service worker's fetch routing", () => {
  test("takes a page navigation, so a dropped connection has something to show", () => {
    expect(handles("https://journal.test/alex/day/one", { mode: "navigate" })).toBe(true);
  });

  test("takes photographs and build assets", () => {
    expect(handles("https://journal.test/_next/static/chunks/main-abc123.js")).toBe(true);
    expect(handles("https://journal.test/alex/media/trip/day/01.jpg")).toBe(true);
  });

  test("takes the story pager's day windows", () => {
    expect(handles("https://journal.test/alex/story.json?trip=alex%2Ftrip&from=0&to=2")).toBe(true);
  });

  /**
   * The bug this pins: an in-site link is not a `navigate` request, it is a
   * fetch of `<path>?_rsc=<build>`. Cached, it hands the router the chunk
   * names of a build that is gone, and the navigation hangs rather than fails.
   */
  test("stands aside for the router's own payloads", () => {
    expect(handles("https://journal.test/alex?_rsc=abc123")).toBe(false);
    expect(handles("https://journal.test/alex/trips?_rsc=zzz")).toBe(false);
    expect(handles("https://journal.test/alex", { rsc: true })).toBe(false);
  });

  test("stands aside for the API, which must never be cached", () => {
    expect(handles("https://journal.test/api/reactions?trip=alex%2Ftrip")).toBe(false);
  });

  test("stands aside for anything that writes, and for other origins", () => {
    expect(handles("https://journal.test/alex", { method: "POST" })).toBe(false);
    expect(handles("https://elsewhere.test/alex")).toBe(false);
  });

  /** Bumping it is how an installed worker drops the previous build's caches. */
  test("names its caches after a version the activate step cleans by", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
    expect(source).toMatch(/const VERSION = "v\d+";/);
  });
});


/**
 * What a navigation is answered with when the network is gone.
 *
 * Both bugs here were reported as something else. The first looked like "the
 * language switcher does nothing"; the second like the site showing a page of
 * raw JSON. A fallback is only ever seen on a bad connection, which is exactly
 * when nobody can tell you what they saw.
 */
async function offlineAnswer(url: string, cached: Cached[]) {
  const handlers = loadWorker(cached, "fail");
  let response: Response | undefined;
  await new Promise<void>((resolve) => {
    handlers.fetch({
      request: {
        url,
        method: "GET",
        mode: "navigate",
        headers: { get: () => null },
      },
      respondWith: (value: Promise<Response>) => {
        void Promise.resolve(value).then((r) => {
          response = r;
          resolve();
        });
      },
      waitUntil: () => {},
    });
  });
  return response;
}

describe("what a navigation falls back to", () => {
  const page = "https://journal.test/alex/day/one";

  test("the same address, from the cache", async () => {
    const answer = await offlineAnswer(page, [{ url: page, body: "day one" }]);
    expect(await answer?.text()).toBe("day one");
  });

  /** `?lang=de` and `?lang=en` are two different pages. */
  test("the copy in the language asked for, not another one", async () => {
    const answer = await offlineAnswer(`${page}?lang=de`, [
      { url: `${page}?lang=en`, body: "english" },
      { url: `${page}?lang=de`, body: "german" },
    ]);
    expect(await answer?.text()).toBe("german");
  });

  test("a query nothing was cached under still finds the page", async () => {
    const answer = await offlineAnswer(`${page}?utm_source=mail`, [{ url: page, body: "day one" }]);
    expect(await answer?.text()).toBe("day one");
  });

  /**
   * The journal's photographs, its story windows and its feed all live under
   * the same first path segment as its pages. The loop that looks for
   * "anything from this journal" matched them, and handed a JPEG or a page of
   * JSON to the browser as the document.
   */
  test("never a photograph or a JSON file dressed as a page", async () => {
    const answer = await offlineAnswer("https://journal.test/alex/day/three", [
      { url: "https://journal.test/alex/media/trip/day/01.jpg", type: "image/jpeg", body: "JPEG" },
      { url: "https://journal.test/alex/story.json", type: "application/json", body: "{}" },
      { url: "https://journal.test/alex/day/two", body: "day two" },
    ]);
    expect(await answer?.text()).toBe("day two");
  });

  test("with nothing readable held, the offline page", async () => {
    const answer = await offlineAnswer("https://journal.test/alex/day/four", [
      { url: "https://journal.test/alex/story.json", type: "application/json", body: "{}" },
      { url: "https://journal.test/offline", body: "You are offline" },
    ]);
    expect(await answer?.text()).toBe("You are offline");
  });

  test("and with nothing at all, a 503 rather than a crash", async () => {
    const answer = await offlineAnswer("https://journal.test/alex/day/five", []);
    expect(answer?.status).toBe(503);
  });
});


/**
 * What everything that is *not* a navigation is answered with when its fetch
 * fails.
 *
 * A subresource fetch fails for two reasons and the common one is not being
 * offline: the browser abandons every request still in flight the moment the
 * reader clicks a link, and a page of photographs always has some in flight.
 * Either way `respondWith` has to be handed a Response. A promise that rejects
 * is printed as `Uncaught (in promise) TypeError: Failed to fetch`, and one
 * that resolves to nothing is a network error just the same — noise in the one
 * console the author reads for real problems, about a photograph the reader
 * had already left.
 */
async function offlineSubresource(url: string, cached: Cached[]) {
  const handlers = loadWorker(cached, "fail");
  return new Promise<Response | undefined>((resolve, reject) => {
    handlers.fetch({
      request: {
        url,
        method: "GET",
        mode: "cors",
        headers: { get: () => null },
      },
      respondWith: (value: Promise<Response>) => {
        void Promise.resolve(value).then(resolve, reject);
      },
      waitUntil: () => {},
    });
  });
}

describe("what a failed subresource fetch is answered with", () => {
  const photo = "https://journal.test/alex/media/trip/day/01.jpg";
  const window_ = "https://journal.test/alex/story.json?from=0&to=2";

  test("a photograph nothing holds: a response, not a rejected promise", async () => {
    const answer = await offlineSubresource(photo, []);
    expect(answer?.status).toBe(503);
  });

  test("a photograph the cache holds is still served", async () => {
    const answer = await offlineSubresource(photo, [
      { url: photo, type: "image/jpeg", body: "JPEG" },
    ]);
    expect(await answer?.text()).toBe("JPEG");
  });

  test("a story window nothing holds: a response, not `undefined`", async () => {
    const answer = await offlineSubresource(window_, []);
    expect(answer?.status).toBe(503);
  });

  test("a story window the cache holds survives the refresh failing", async () => {
    const answer = await offlineSubresource(window_, [
      { url: window_, type: "application/json", body: '{"days":[]}' },
    ]);
    expect(await answer?.text()).toBe('{"days":[]}');
  });
});

/**
 * B412 — the one authenticated response this worker keeps.
 *
 * The whole risk of caching it is that its content is *the list of private
 * journals one person may open*. Cached the way everything else here is —
 * one bucket keyed by URL — the next person to open the app on a shared phone
 * is served the previous reader's list. So most of this describes the wall
 * rather than the caching.
 */
describe("the signed-in home payload", () => {
  test("the worker takes it, unlike everything else under /api/", async () => {
    expect(handles(HOME)).toBe(true);
    // The exemption is one exact path, not a loosened prefix. A prefix test is
    // one careless route away from caching somebody's contacts page.
    expect(handles("https://journal.test/api/v1/me/devices/abc")).toBe(false);
    expect(handles("https://journal.test/api/v1/ana/status")).toBe(false);
    expect(handles("https://journal.test/api/auth/logout")).toBe(false);
  });

  test("a fresh answer is stored under a cache named for the reader", async () => {
    const { handlers, caches } = loadWorkerWithCaches(async () => homePayload("aaaa1111"));
    await run(handlers, HOME);
    expect([...caches.named.keys()]).toContain("personal-aaaa1111");
  });

  /** The point of the exercise: the list of journal names this device last
   * saw, when there is no network to ask. */
  test("offline, it serves the copy this device last saw", async () => {
    let online = true;
    const { handlers } = loadWorkerWithCaches(async () => {
      if (!online) throw new Error("offline");
      return homePayload("aaaa1111");
    });

    await run(handlers, HOME);
    online = false;
    const offline = await run(handlers, HOME);
    expect(offline?.status).toBe(200);
    expect(await offline!.json()).toMatchObject({ id: "aaaa1111" });
  });

  /**
   * The one that matters. Two readers, one browser profile, in sequence — the
   * shared-phone case this whole arrangement exists for.
   */
  test("a second reader is never served the first one's list", async () => {
    let id = "aaaa1111";
    let online = true;
    const { handlers, caches } = loadWorkerWithCaches(async () => {
      if (!online) throw new Error("offline");
      return homePayload(id);
    });

    await run(handlers, HOME);
    id = "bbbb2222";
    await run(handlers, HOME);

    // One identity cached at a time: the first reader's copy is gone, not
    // merely unreferenced. A cache nothing points at is still a cache a bug
    // can open.
    expect([...caches.named.keys()]).not.toContain("personal-aaaa1111");

    online = false;
    const offline = await run(handlers, HOME);
    expect(await offline!.json()).toMatchObject({ id: "bbbb2222" });
  });

  test("a refused credential takes the cached copy with it", async () => {
    let status = 200;
    const { handlers, caches } = loadWorkerWithCaches(async () =>
      status === 200
        ? homePayload("aaaa1111")
        : new Response(JSON.stringify({ error: "not_signed_in" }), { status }),
    );

    await run(handlers, HOME);
    expect([...caches.named.keys()]).toContain("personal-aaaa1111");

    // Revoked elsewhere, or expired.
    status = 401;
    await run(handlers, HOME);
    expect([...caches.named.keys()].filter((k) => k.startsWith("personal-"))).toEqual([]);
  });

  /** The capability being switched off is the same answer as being signed
   * out, as far as a device holding a cached copy is concerned. */
  test("a 404 from a disabled capability purges too", async () => {
    let status = 200;
    const { handlers, caches } = loadWorkerWithCaches(async () =>
      status === 200 ? homePayload("aaaa1111") : new Response("{}", { status }),
    );
    await run(handlers, HOME);
    status = 404;
    await run(handlers, HOME);
    expect([...caches.named.keys()].filter((k) => k.startsWith("personal-"))).toEqual([]);
  });

  test("signing out clears it at once, without waiting for a refusal", async () => {
    const { handlers, caches } = loadWorkerWithCaches(async () => homePayload("aaaa1111"));
    await run(handlers, HOME);
    expect([...caches.named.keys()]).toContain("personal-aaaa1111");

    const pending: Promise<unknown>[] = [];
    handlers.message({
      data: { type: "fernscout-signed-out" },
      waitUntil: (p: Promise<unknown>) => pending.push(p),
    });
    await Promise.all(pending);

    expect([...caches.named.keys()].filter((k) => k.startsWith("personal-"))).toEqual([]);
  });

  /**
   * Since B443 a stranger gets a `200` with `id: null` rather than a `401`, so
   * the body — not the status — is what tells a device holding a cached copy
   * that the credential behind it is gone.
   */
  test("a 200 saying nobody is signed in purges the cached copy", async () => {
    let signedIn = true;
    const { handlers, caches } = loadWorkerWithCaches(async () =>
      signedIn
        ? homePayload("aaaa1111")
        : new Response(JSON.stringify({ id: null, journals: [], devices: [] }), {
            status: 200,
          }),
    );

    await run(handlers, HOME);
    expect([...caches.named.keys()]).toContain("personal-aaaa1111");

    signedIn = false;
    await run(handlers, HOME);
    expect([...caches.named.keys()].filter((k) => k.startsWith("personal-"))).toEqual([]);
  });

  /**
   * A response with no id is not cached under some fallback name. A fallback
   * name is a shared name, and a shared name is the bug this exists to stop.
   */
  test("an answer with no reader id in it is not cached at all", async () => {
    const { handlers, caches } = loadWorkerWithCaches(
      async () => new Response("not json", { status: 200 }),
    );
    await run(handlers, HOME);
    expect([...caches.named.keys()].filter((k) => k.startsWith("personal-"))).toEqual([]);
  });

  /**
   * Personal caches are named after a reader rather than a build, so the
   * activate step must not sweep them with the rest: doing so would sign every
   * installed app out of its offline copy on every deploy.
   */
  test("a version bump does not drop the reader's copy", async () => {
    const { handlers, caches } = loadWorkerWithCaches(async () => homePayload("aaaa1111"));
    await run(handlers, HOME);

    const pending: Promise<unknown>[] = [];
    handlers.activate({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);

    expect([...caches.named.keys()]).toContain("personal-aaaa1111");
  });
});
