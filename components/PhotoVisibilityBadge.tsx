import { EyeOff } from "lucide-react";
import type { PhotoVisibility, ReaderLevel } from "@/lib/photos";
import { useI18n } from "./LocaleProvider";

/**
 * The one place a `guest` or `private` photograph shows its own label — B631.
 *
 * `visible()` in lib/entries.ts already strips a photograph nobody may see;
 * this only marks the ones that survived, and only for a reader `readFor`
 * proved is `"person"` — the owner, or somebody on the trip. Everybody else
 * either sees no marker (a `guest` reader, on a photograph they may read) or
 * sees no photograph at all, so there is nothing here to leak.
 */
export default function PhotoVisibilityBadge({
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
    <span className="absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-full bg-navy-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
      <EyeOff className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
