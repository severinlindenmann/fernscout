import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import OfflineNotice from "@/components/OfflineNotice";

/**
 * What the service worker serves when a page is wanted, the network is gone,
 * and nothing matching is in the cache.
 *
 * It exists so that "no signal" stops looking like "the site is broken". The
 * previous fallback was `caches.match("/")`, which is a redirect to somebody's
 * journal — not a page, so on a cold cache it resolved to nothing and the
 * reader got the browser's own dinosaur.
 *
 * Precached at install, which is the only way it can be there when it is
 * needed. `/offline` is reserved in lib/users.ts so no journal can shadow it.
 */
/** The tab title follows the reader; see the note in the gallery page. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translateIn(await requestLocale(), "err.offlineTitle"),
    robots: { index: false, follow: false },
  };
}

export default function Offline() {
  return <OfflineNotice />;
}
