import { listIdentities } from "@/lib/auth";
import { resolveIdentity } from "@/lib/auth/handshake";
import { isEnabled } from "@/lib/capabilities";
import { journalsFor } from "@/lib/home";

export const dynamic = "force-dynamic";

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
 */
export async function GET() {
  if (!isEnabled("auth")) {
    return Response.json({ error: "auth_disabled" }, { status: 404 });
  }

  const identity = await resolveIdentity();
  if (!identity) {
    // 401 rather than an empty body: B412's service worker purges its cached
    // copy on exactly this status, which is what makes a revoked identity stop
    // showing a stale list on the next load.
    return Response.json({ error: "not_signed_in" }, { status: 401 });
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
    {
      // Never stored by a shared cache, and never revalidated from one. This
      // is one person's list of private journals; the only cache it may sit in
      // is the identity-keyed one B412 keeps in the service worker.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
