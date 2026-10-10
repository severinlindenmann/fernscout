import type { HomeDevice, HomeJournal } from "@/components/HomeJournals";

/**
 * What `GET /api/v2/me/home` answers — one address's journals and devices.
 *
 * Shared by the two pages that are about the person rather than a journal:
 * `/` (its signed-in half) and `/me`.
 */
export type HomePayload = {
  /** The reader's opaque identity id, or `null` for nobody — see the route. */
  id: string | null;
  email: string;
  journals: HomeJournal[];
  devices: HomeDevice[];
  /** True when this address runs the instance — B746. Decides whether the
   *  operator link is offered, and nothing else: `/admin` asks
   *  `isInstanceAdmin()` for itself, so a forged `true` reaches a 404. */
  admin?: boolean;
  /** The trip link this browser holds, for the keep card — B-2962. */
  link?: HomeLink | null;
  /** When the server wrote this answer, from the response's `Date` header —
   *  B-2975. Added here, never sent by the API. The offline worker serves its
   *  saved copy with the original header, so an old one means a saved copy. */
  checkedAt?: number;
};

/** An answer older than this was not just fetched; the page says so. */
export const SAVED_COPY_AFTER_MS = 10 * 60_000;

export type HomeLink = {
  ownerName: string;
  tripTitle: string;
  keepPath: string;
  token: string;
  signupEnabled: boolean;
  kept: boolean;
};

/**
 * Whether this browser was signed in last time it looked.
 *
 * Not a credential and not trusted as one — the server decides, every time,
 * and the worst a forged value can do is show a skeleton to a stranger for one
 * network round trip. What it buys is the absence of a flash.
 */
export const SEEN_KEY = "fs-home-signed-in";

/**
 * Ask who is signed in, upgrading a journal-only session once — B1493.
 *
 * `id: null` from a stranger, a switched-off `auth`, or an identity that was
 * actually revoked stays `id: null`. But it is also what a reader signed into
 * a journal before B410 sees: they hold `fs_session` and no `fs_identity`, and
 * `/me/home` answers from the identity alone (a journal cookie must not answer
 * an instance-wide question by itself). So mint the identity a live journal
 * session already earns, once, and re-ask before concluding nobody is signed
 * in.
 *
 * `live` is checked between the steps so a page that has gone away does not
 * spend a request upgrading a session nobody is looking at. Rejects when the
 * first request cannot be made at all (offline); the caller decides what the
 * honest fallback is.
 */
export async function probeHome(live: () => boolean = () => true): Promise<HomePayload | null> {
  const fetchHome = () =>
    fetch("/api/v2/me/home", { headers: { accept: "application/json" } }).then(
      async (res) => {
        if (!res.ok) return null;
        const data = (await res.json()) as HomePayload;
        const at = Date.parse(res.headers?.get?.("date") ?? "");
        return Number.isNaN(at) ? data : { ...data, checkedAt: at };
      },
    );
  const data = await fetchHome();
  if (!live() || data?.id) return data;
  const upgraded = await fetch("/api/auth/identity/upgrade", { method: "POST" })
    .then((res) => (res.ok ? (res.json() as Promise<{ issued?: boolean }>) : null))
    .catch(() => null);
  if (!live() || !upgraded?.issued) return data;
  return fetchHome().catch(() => data);
}
