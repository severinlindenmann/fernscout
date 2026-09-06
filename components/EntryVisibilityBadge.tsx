import { EyeOff } from "lucide-react";
import type { PhotoVisibility, ReaderLevel } from "@/lib/photos";
import { useI18n } from "./LocaleProvider";

/**
 * The one place a `guest` or `private` update shows its own label — B632,
 * the day-level sibling of `PhotoVisibilityBadge` (B631).
 *
 * `visible()` in lib/entries.ts already drops an update nobody may see
 * outright; this only marks the ones that survived, and only for a reader
 * `readFor` proved is `"person"` — the owner, or somebody on the trip.
 * Everybody else either sees no marker (a `guest` reader, on an update they
 * may read) or sees no update at all, so there is nothing here to leak.
 *
 * Inline rather than absolutely positioned: `PhotoVisibilityBadge` sits on
 * top of an image tile and needs to float in a corner; this sits beside a
 * day's own draft badge, in the flow of the heading, and has no picture to
 * float over.
 */
export default function EntryVisibilityBadge({
  visibility,
  reader,
}: {
  visibility: PhotoVisibility | undefined;
  reader: ReaderLevel | undefined;
}) {
  const { t } = useI18n();
  if (!visibility || reader !== "person") return null;
  const label = t(visibility === "guest" ? "photo.visibilityGuest" : "photo.visibilityPrivate");
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-coral-600 bg-coral-100 px-2.5 py-0.5 font-display text-xs font-semibold text-navy-900">
      <EyeOff className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
