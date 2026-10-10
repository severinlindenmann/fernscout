/** A short id per request: returned as `x-request-id`, written into the
 * `[request]` log line, shown beside the digest on the error screens (B-2951).
 * Random, never derived from the request; not a secret. */
export const REQUEST_ID_HEADER = "x-request-id";

export function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

/** Browser side: the id the root layout put in `<meta name="request-id">`. It
 * belongs to the document load, so after a soft navigation it can be older
 * than the failing request. */
export function pageRequestId(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="request-id"]')?.content || null;
}
