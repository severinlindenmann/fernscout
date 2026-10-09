import Link from "next/link";
import { ownerShortName } from "@/lib/contacts/welcome";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { linkOnlyReader } from "@/lib/tripGate";
import type { Trip } from "@/lib/types";
import { getUser } from "@/lib/users";

/**
 * "Reading with <owner>'s link — Keep it" (B-2964). Only for a browser let in
 * by nothing but the trip link's cookie; owners, travellers, guests and
 * keepers never see it, and a public trip never gets as far as the cookie.
 */
export default async function TripLinkBar({ trip }: { trip: Trip }) {
  const user = getUser(trip.username);
  if (!user || !(await linkOnlyReader(trip))) return null;
  const locale = await requestLocale();
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 bg-ink-strong px-4 py-1 text-sm text-surface-base">
      <span>{translateIn(locale, "tripLink.bar", { owner: ownerShortName(user) })}</span>
      <Link
        href={`${journalPath(trip.username)}/me#keep`}
        className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        {translateIn(locale, "tripLink.barKeep")}
      </Link>
    </div>
  );
}
