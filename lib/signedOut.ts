/**
 * Tell the service worker that the credential it was caching for is gone —
 * B412.
 *
 * The worker keeps one authenticated response, the signed-in home payload, in
 * a cache named after the reader. It learns that a credential has been refused
 * when a request comes back 401, and it would learn about a sign-out the same
 * way — on the *next* load. That is one load too late on the device this
 * matters on, which is a borrowed or shared one.
 *
 * So the page says so directly. `/api/auth/logout` is a POST the worker stands
 * aside for and must keep standing aside for, so there is nothing for it to
 * observe; the page is the only party that knows.
 *
 * Best-effort by construction. No service worker, no controller yet, an older
 * worker still in control after a deploy — all of them mean the message goes
 * nowhere, and all of them are survivable: the cached copy is a list of
 * journal names, the credential behind it is already revoked server-side, and
 * the next request purges it anyway.
 */
export function tellWorkerSignedOut(): void {
  if (typeof navigator === "undefined") return;
  navigator.serviceWorker?.controller?.postMessage({ type: "fernscout-signed-out" });
}
