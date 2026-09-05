/* Service worker for a Fernscout site.
 *
 * Two jobs:
 *   1. Receive push notifications (the reason it exists on iOS at all).
 *   2. Serve the site from cache, so a dropped connection between two days
 *      doesn't look like a broken site.
 *
 * The caching is written for a reader on 3G on a bus rather than for a
 * reviewer at a desk. Three routes through the fetch handler, because three
 * kinds of thing behave differently when the signal is bad:
 *
 *   Navigations   Network first, but only for NAV_TIMEOUT_MS. A stalled
 *                 mobile connection does not fail — it hangs, sometimes for a
 *                 minute — and hanging in front of a page we already hold is
 *                 the worst outcome available. After the timeout the cached
 *                 copy wins, and the network response, if it ever lands, is
 *                 still written to the cache for next time.
 *   JSON data     Stale-while-revalidate. The story pager fetches its day
 *                 windows from `/<user>/story.json`, which is not under /api
 *                 and so used to fall into the cache-first branch below —
 *                 meaning a reader who came back a week later got last week's
 *                 days, permanently. Serving the cached copy and refreshing
 *                 behind it is both instant and eventually correct.
 *   Everything    Cache first. Build assets and photographs: their filenames
 *   else          are content-hashed, so a hit is never stale.
 *   The home      Network first, cache only when there is no network at all,
 *   payload       and kept in a cache named after the reader — B412. The one
 *                 authenticated response here, and the only thing under
 *                 `/api/` that is written down at all. See PERSONAL_PATH.
 *
 * Two kinds of request are handed straight back to the network, uncached:
 * anything under /api/, and the App Router's own `?_rsc=` payloads. See the
 * fetch handler for why the second one matters.
 *
 * Every one of the three answers a request with a Response even when there is
 * nothing to answer it with — an empty 503. Rejecting instead, or resolving
 * with nothing, turns each abandoned photograph into a console error and tells
 * the author their site is broken when a reader merely followed a link.
 *
 * Known, and deliberately not fixed here: the runtime cache is trimmed by
 * insertion order, which is not an LRU. On a five-month trip with thousands of
 * photographs that evicts the oldest cached days first — the right guess, but
 * only a guess.
 */

const VERSION = "v5";
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

/**
 * The one authenticated response this worker is allowed to keep, and the
 * separate caches it keeps it in — B412.
 *
 * Everything else under `/api/` goes straight to the network and is never
 * written down. This one is the signed-in home view's payload: the list of
 * journals one person may open. Without it the installed PWA opens to nothing
 * on a bad connection, which is the opposite of the point; with it cached the
 * way this worker caches everything else — one bucket keyed by URL — the next
 * person to open the app on a shared phone is served the previous reader's
 * list.
 *
 * So it is kept apart, in a cache named after the reader. The name is the
 * **opaque public id** from the response body, never the credential:
 * `fs_identity` is httpOnly and a service worker cannot read it, which is the
 * correct state and the reason `public_id` exists at all (`019-identity`).
 *
 * `PERSONAL_POINTER` holds one entry whose body is the id currently cached. A
 * cold offline open has no response to read an id from, so without it the
 * worker would not know which `personal-…` cache is the right one. It is a
 * Cache rather than IndexedDB deliberately: this file must keep working when
 * everything else has failed, and that is a weaker promise with two storage
 * APIs in it than with one.
 */
const PERSONAL_PATH = "/api/v1/me/home";
const PERSONAL_PREFIX = "personal-";
const PERSONAL_POINTER = `${PERSONAL_PREFIX}pointer`;
/** A URL that is never fetched. It only has to be a stable cache key. */
const POINTER_KEY = "https://fernscout.invalid/personal-id";

/** Long enough for a slow but working connection, short enough that nobody
 * decides the site is broken. */
const NAV_TIMEOUT_MS = 4000;

/** Photographs are large and the Cache API exposes no size, so this is a
 * count rather than a budget. Applied after each write. */
const RUNTIME_MAX_ENTRIES = 300;

/* The only URL that can be precached on a multi-user instance: journals live
 * at /<user>/… and the worker has no idea whose page it is being installed
 * from. The previous list — "/", "/map", "/gallery", "/costs" — predates that
 * and cached three URLs that no longer exist. Everything else arrives through
 * the runtime cache on first visit, which is what happens in practice anyway:
 * you read a day and then lose signal, not the other way round. */
const PRECACHE = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(PRECACHE))
      // A failed precache must not block activation — the runtime cache will
      // pick these up on first visit instead.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Personal caches are named after a reader rather than a build, so
            // a version bump must not sweep them: doing so would sign every
            // installed app out of its offline copy on every deploy. They are
            // cleared by signing out, by a 401, and by a different identity
            // arriving — see `rememberPersonal`.
            .filter((k) => !k.endsWith(VERSION) && !k.startsWith(PERSONAL_PREFIX))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trimRuntime() {
  const cache = await caches.open(RUNTIME);
  const keys = await cache.keys();
  if (keys.length <= RUNTIME_MAX_ENTRIES) return;
  await Promise.all(
    keys.slice(0, keys.length - RUNTIME_MAX_ENTRIES).map((k) => cache.delete(k)),
  );
}

async function putRuntime(request, response) {
  if (!response || !response.ok || response.type !== "basic") return;
  const cache = await caches.open(RUNTIME);
  await cache.put(request, response);
  await trimRuntime();
}

/**
 * Handed back when a request can be answered from neither the cache nor the
 * network. It has to *be* a Response. A promise given to `respondWith` that
 * rejects is printed as `Uncaught (in promise) TypeError: Failed to fetch`,
 * and one that resolves to nothing is a network error just the same — and in
 * both cases the console the author reads for real problems fills up with
 * something that is usually not even a fault. A subresource fetch fails for
 * two reasons and the common one is not being offline: the browser abandons
 * every request still in flight the moment the reader clicks a link, and a
 * page of photographs always has some in flight.
 */
function unavailable() {
  return new Response("", { status: 503, statusText: "Offline" });
}

/**
 * What to show when a navigation cannot reach the network.
 *
 * The cached page for this URL, then any cached page from the same journal,
 * then the offline page. The middle step is what stops an unread day looking
 * like a dead site: somebody who read day four and then opens day five gets
 * their own journal's shell rather than a stranger's, or nothing at all.
 */
/** Only a cached HTML document may be served in answer to a navigation. */
function isDocument(response) {
  const type = response?.headers.get("content-type") || "";
  return response?.ok === true && type.includes("text/html");
}

async function navigationFallback(request) {
  // Exact first, query and all. `?lang=de` and `?lang=en` are two different
  // pages, and answering one with the other is how "the language switcher
  // does nothing" happened: the switch navigated, the network was slow, and
  // the fallback handed back the copy in the language being switched away
  // from. Only if there is no exact copy do we ignore the query, which is
  // what makes a link arriving with somebody's `?utm_…` on it still work.
  for (const options of [undefined, { ignoreSearch: true }]) {
    const hit = await caches.match(request, options);
    if (isDocument(hit)) return hit;
  }

  // Nothing for this address. Any other page from the same journal at least
  // keeps the reader inside the site they were reading, with its navigation
  // intact, rather than dropping them on the generic offline page — but it
  // has to *be* a page. The cache is keyed by URL and holds this journal's
  // photographs, its `story.json` and its feed under the same first path
  // segment, and this loop returned whichever came first: a reader who lost
  // signal could be shown a JPEG or a page of raw JSON as though it were the
  // site. `isDocument` is the whole fix.
  const owner = new URL(request.url).pathname.split("/")[1];
  if (owner) {
    const cache = await caches.open(RUNTIME);
    for (const key of await cache.keys()) {
      const url = new URL(key.url);
      if (url.pathname.split("/")[1] !== owner) continue;
      const page = await cache.match(key);
      if (isDocument(page)) return page;
    }
  }

  const offline = await caches.match("/offline");
  return offline || unavailable();
}

/**
 * Remember one reader's home payload, under a cache named after them.
 *
 * **One identity at a time.** Caching a second reader's list beside the first
 * would leave the first sitting there, readable by any future bug that opened
 * the wrong cache, for the sake of making a sign-in the phone's owner rarely
 * performs marginally faster. So arriving as a different identity clears every
 * other personal cache first.
 *
 * A response with no id in it is not cached at all rather than cached under
 * some fallback name: a fallback name is a shared name, and a shared name is
 * the bug this whole arrangement exists to prevent.
 */
async function rememberPersonal(request, response) {
  let id = null;
  try {
    id = (await response.clone().json()).id;
  } catch {
    id = null;
  }
  if (typeof id !== "string" || id.length === 0) return;

  const mine = `${PERSONAL_PREFIX}${id}`;
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((k) => k.startsWith(PERSONAL_PREFIX) && k !== mine && k !== PERSONAL_POINTER)
      .map((k) => caches.delete(k)),
  );

  const cache = await caches.open(mine);
  await cache.put(request, response.clone());

  const pointer = await caches.open(PERSONAL_POINTER);
  await pointer.put(POINTER_KEY, new Response(id));
}

/**
 * The cached home payload for whoever this device last knew, or null.
 *
 * **Known limit, and it is a real one.** A device that is offline still shows
 * this list after the identity behind it has been revoked somewhere else,
 * until it next reaches the network. Journal names and trip titles, never
 * content — every page they link to is its own request, and each of those is
 * refused by the server the moment there is a server to refuse it.
 *
 * It is not fixable here: knowing that a credential was revoked requires
 * asking, and the thing that has failed is the asking. The alternative is to
 * cache nothing, which costs every reader on a bad connection a working app to
 * protect against a case where the phone is already in someone else's hands
 * *and* has no signal.
 */
async function cachedPersonal(request) {
  const pointer = await caches.open(PERSONAL_POINTER);
  const held = await pointer.match(POINTER_KEY);
  if (!held) return null;
  const id = await held.text();
  if (!id) return null;
  const cache = await caches.open(`${PERSONAL_PREFIX}${id}`);
  return (await cache.match(request)) || null;
}

/**
 * Forget everything personal on this device.
 *
 * Three callers, and they are the three ways a credential stops being valid:
 * signing out (the page tells us), the server refusing the credential, and the
 * capability being switched off. All of them mean the same thing here.
 */
async function purgePersonal() {
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith(PERSONAL_PREFIX)).map((k) => caches.delete(k)),
  );
}

/**
 * The signed-in home payload: network first, cache only as a fallback.
 *
 * Never stale-while-revalidate, which is how the rest of the JSON on this site
 * is served. That policy shows the cached copy *and then* refreshes, which is
 * right for a day's photographs and wrong for an access list: it would show a
 * journal somebody had just been removed from, every time, for one paint. The
 * cached copy here is strictly a fallback for having no network at all.
 */
async function personalRequest(event, request) {
  try {
    const res = await fetch(request);
    // 401 is a revoked or expired identity; 404 is the capability being off.
    // Either way this device is not entitled to a cached copy any more.
    if (res.status === 401 || res.status === 404) {
      event.waitUntil(purgePersonal());
      return res;
    }
    if (res.ok) event.waitUntil(rememberPersonal(request, res.clone()));
    return res;
  } catch {
    // Offline. The list of journal names this device last saw is the whole
    // point of the exercise.
    return (await cachedPersonal(request)) || unavailable();
  }
}

/**
 * Signing out clears the cached copy at once, rather than waiting for the next
 * request to be refused.
 *
 * The page sends this because it is the only party that knows a sign-out
 * happened: the request goes to `/api/auth/logout`, which this worker stands
 * aside for and must keep standing aside for.
 */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "fernscout-signed-out") {
    event.waitUntil(purgePersonal());
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // The one authenticated response this worker keeps, and it is kept apart —
  // see PERSONAL_PATH. Named exactly, never by prefix: a prefix test here is
  // one careless route away from caching somebody's contacts page.
  if (url.pathname === PERSONAL_PATH) {
    event.respondWith(personalRequest(event, request));
    return;
  }

  // Reaction counts, auth and anything that writes must never come from a
  // cache, and must never be written to one.
  if (url.pathname.startsWith("/api/")) return;

  // The App Router's navigation payloads. A click on an in-site link is not a
  // `navigate` request — it is a fetch of `/example?_rsc=<build>` — so without
  // this it fell through to the cache-first branch at the bottom and was kept
  // forever. The payload names the JavaScript chunks of the build that
  // produced it; serve an old one and the router waits for files the server no
  // longer has. That is a navigation that hangs rather than fails, which is
  // the worst shape a bug can take. Next keeps its own client-side cache of
  // these, so there is nothing here for us to improve on.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      new Promise((resolve) => {
        let settled = false;
        const done = (res) => {
          if (settled) return;
          settled = true;
          resolve(res);
        };

        const timer = setTimeout(() => {
          navigationFallback(request).then(done);
        }, NAV_TIMEOUT_MS);

        fetch(request)
          .then((res) => {
            clearTimeout(timer);
            // Cached even when the timeout already served the stale copy: the
            // point of finishing the round trip is to make the *next* open
            // correct.
            event.waitUntil(putRuntime(request, res.clone()));
            done(res);
          })
          .catch(() => {
            clearTimeout(timer);
            navigationFallback(request).then(done);
          });
      }),
    );
    return;
  }

  // Journal data: the story pager's day windows and the search index.
  if (url.pathname.endsWith(".json")) {
    event.respondWith(
      caches
        .match(request)
        .then((hit) => {
          const fresh = fetch(request)
            .then((res) => {
              event.waitUntil(putRuntime(request, res.clone()));
              return res;
            })
            .catch(() => hit || unavailable());
          return hit || fresh;
        })
        .catch(unavailable),
    );
    return;
  }

  // Everything else (build assets, photos): cache first. The trailing catch
  // covers the fetch and the cache lookup alike — a browser that has run out
  // of storage rejects `caches.match`, and that must not be louder than a
  // missing photograph either.
  event.respondWith(
    caches
      .match(request)
      .then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            event.waitUntil(putRuntime(request, res.clone()));
            return res;
          }),
      )
      .catch(unavailable),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  // The site name travels in the payload; this only covers a malformed push.
  const title = payload.title || "New update";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "",
      icon: payload.icon || "/apple-icon",
      badge: "/icon.svg",
      // Same tag for a day means a re-send replaces rather than stacks.
      tag: payload.tag || "new-day",
      data: { url: payload.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Focus an open tab if there is one rather than piling up windows.
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
