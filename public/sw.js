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
 *
 * Two kinds of request are handed straight back to the network, uncached:
 * anything under /api/, and the App Router's own `?_rsc=` payloads. See the
 * fetch handler for why the second one matters.
 *
 * Known, and deliberately not fixed here: the runtime cache is trimmed by
 * insertion order, which is not an LRU. On a five-month trip with thousands of
 * photographs that evicts the oldest cached days first — the right guess, but
 * only a guess.
 */

const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;

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
        Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))),
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
  return offline || new Response("", { status: 503, statusText: "Offline" });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
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
      caches.match(request).then((hit) => {
        const fresh = fetch(request)
          .then((res) => {
            event.waitUntil(putRuntime(request, res.clone()));
            return res;
          })
          .catch(() => hit);
        return hit || fresh;
      }),
    );
    return;
  }

  // Everything else (build assets, photos): cache first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          event.waitUntil(putRuntime(request, res.clone()));
          return res;
        }),
    ),
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
