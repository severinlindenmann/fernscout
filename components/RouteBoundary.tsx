import { Suspense, type ReactNode } from "react";
import { headers } from "next/headers";
import RouteSkeleton from "./RouteSkeleton";

/**
 * Whether the browser asked for this answer from script rather than to show it
 * as a document — the Fetch Metadata request header every current browser
 * sends: `document` for a page load, `empty` for a `fetch()`.
 *
 * The app router's client-side navigation is a `fetch()`, and that is the
 * request this is looking for. Next's own marker for it (`RSC: 1`) is not an
 * option: this version deliberately hides its router headers from
 * `headers()` (`HIDDEN_REQUEST_HEADERS` in
 * next/dist/server/async-storage/request-store), and working round that would
 * be building on something the framework has said is not ours to read.
 *
 * The one other `fetch()` of a page here is the service worker keeping a trip
 * for offline reading (public/sw.js). It gets the boundary too, which costs it
 * nothing it would notice: the body is in the same response either way. A
 * request with no such header at all — an old browser, a crawler, `curl` — is
 * treated as a document load, which is the answer that changes nothing.
 */
const FETCH_DEST = "sec-fetch-dest";

/**
 * The line a heavy reading page draws between what it has decided and what
 * only takes time — components/RouteSkeleton.tsx says why the page, not a
 * `loading.tsx`, draws it.
 *
 * **Only on a client-side navigation.** That is where it pays: the router can
 * draw the skeleton from the first bytes of the answer instead of waiting out
 * the whole payload. On a document load it would cost instead. The server
 * finishes the body in the same pass either way, but a boundary that was still
 * pending when the HTML shell went out has its content revealed on React's
 * reveal throttle — measured, the lifetime map's and a trip map's largest
 * paint moved from ~640–720 ms to ~940–1030 ms on a throttled phone
 * connection, for nothing a reader could see. So a document load gets the
 * body with no boundary around it, exactly as before this existed.
 *
 * Nothing about the reader decides which: the header says only how the
 * browser asked, and every status and every gate is settled by the page before
 * this is rendered at all.
 */
export default async function RouteBoundary({
  shape,
  children,
}: {
  shape: Parameters<typeof RouteSkeleton>[0]["shape"];
  children: ReactNode;
}) {
  if ((await headers()).get(FETCH_DEST) !== "empty") return children;
  return <Suspense fallback={<RouteSkeleton shape={shape} />}>{children}</Suspense>;
}
