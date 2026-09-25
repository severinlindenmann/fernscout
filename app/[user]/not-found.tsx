import JournalNotFoundNotice from "@/components/JournalNotFoundNotice";

/**
 * A miss inside a journal that does exist.
 *
 * Catches `notFound()` from every page under `/[user]` — a day slug that was
 * renamed, a trip that was taken down, a page that never existed — plus the
 * `trips/[trip]` layout, whose own throw is handled by the nearest boundary
 * *above* the segment that threw.
 *
 * Not a `metadata` export: `not-found.tsx` shares its segment's metadata, and
 * Next already sends `noindex` with the 404 status.
 */
export default function JournalNotFound() {
  return <JournalNotFoundNotice />;
}
