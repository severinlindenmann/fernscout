import { listIdentities } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { journalsFor } from "@/lib/home";

export const dynamic = "force-dynamic";

/** Never stored by a shared cache, and never revalidated from one. This is one
 * person's list of private journals; the only cache it may sit in is the
 * identity-keyed one B412 keeps in the service worker. */
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * What this person may open, and on which devices they are signed in — B411.
 *
 * Served as JSON rather than rendered into `/` so that B412 can cache it apart
 * from the page. The page itself is a shell with no personal data in it and
 * stays cacheable by anybody; everything here is one reader's and is kept in a
 * cache named after `id` below.
 *
 * **`fs_identity` and nothing else.** A journal cookie proves an address too,
 * but only for one journal, and honouring it here would turn a year-long read
 * cookie for `/alice` into a directory of every other journal that address has
 * been let into. `resolveIdentity` asks `resolveSession` for the `identity`
 * kind, so a guest cookie, an agent bearer token and a handover credential are
 * each refused by the same comparison that refuses them everywhere else.
 *
 * ## Why nobody is a `200` and not a `401` — B443
 *
 * This is a probe for who the reader is, not a protected resource, and `/`
 * fires it on every load — most of which are strangers, because `fs_identity`
 * is httpOnly and the page is deliberately impersonal, so nothing on it can
 * know not to ask. Answering `401` put a red line in the console of an
 * ordinary working visit, every time, and a console that is never clean is one
 * nobody reads. Nothing is withheld by saying it plainly instead: there is no
 * credential to retry with and no list to hide.
 *
 * `id: null` is the whole signal, and both readers of this route take it that
 * way — the page shows the landing view, and the service worker purges its
 * cached copy on a body with no id in it exactly as it did on the status.
 * The capability being off is the same answer for the same reason.
 */
export async function GET() {
  const identity = isEnabled("auth") ? await resolveIdentity() : null;
  if (!identity) {
    return Response.json(
      { id: null, email: null, journals: [], devices: [] },
      { headers: NO_STORE },
    );
  }

  const [journals, devices] = await Promise.all([
    journalsFor(identity.email),
    listIdentities(identity.email),
  ]);

  return Response.json(
    {
      /** The opaque name of *this* device's identity. Never the token. */
      id: identity.publicId,
      email: identity.email,
      journals,
      devices: devices.map((row) => ({
        id: row.id,
        publicId: row.publicId,
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        userAgent: row.userAgent,
        /** Which row is the browser asking. The page marks it "this device"
         * so nobody signs themselves out wondering which one they are. */
        current: row.id === identity.id,
      })),
    },
    { headers: NO_STORE },
  );
}
