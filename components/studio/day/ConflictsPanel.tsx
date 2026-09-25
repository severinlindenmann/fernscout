"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import ConflictCard from "@/components/studio/day/ConflictCard";
import { hasOutbox, openOutboxStore, pendingConflicts, type DayEditConflict } from "@/lib/outbox";

/** `/api/web/{user}/trips/{trip}/days/{slug}` — `EditDay.tsx`'s own
 *  `dayApiUrl`. Parsed back apart only to link to "Change a day", never to
 *  build a request. */
const DAY_URL = /^\/api\/web\/[^/]+\/trips\/[^/]+\/days\/([^/]+)$/;

/** D3, reached from the pill's own "N needs a decision" — every `day.edit`
 *  left as a conflict for this owner, across every day, each its own
 *  `ConflictCard`. Polled the same way `AddDayFlow`'s own "waiting" marker
 *  is (`pendingDates`): a plain re-read on mount and after each resolve,
 *  never its own IndexedDB subscription. */
export default function ConflictsPanel({ username }: { username: string }) {
  const { t } = useI18n();
  const [conflicts, setConflicts] = useState<DayEditConflict[] | null>(null);

  const refresh = useCallback(() => {
    // Always resolved async, even the "no outbox" case — a synchronous
    // `setConflicts` here, called straight from the effect below, is the
    // cascading-render shape `react-hooks/set-state-in-effect` refuses.
    const read = hasOutbox() ? pendingConflicts(openOutboxStore(), username) : Promise.resolve([]);
    void read.then(setConflicts);
  }, [username]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (conflicts === null) return null;
  if (conflicts.length === 0) {
    return <p className="text-sm text-ink-secondary">{t("studio.conflicts.none")}</p>;
  }

  return (
    <div>
      {conflicts.map((conflict) => {
        const slug = DAY_URL.exec(conflict.url)?.[1];
        return (
          <div key={conflict.id}>
            <ConflictCard conflict={conflict} onResolved={refresh} />
            {slug && (
              <Link
                href={`/${username}/studio/day/edit?slug=${encodeURIComponent(decodeURIComponent(slug))}`}
                className="mt-1 inline-block text-sm font-semibold text-ink-strong underline underline-offset-2"
              >
                {t("studio.conflicts.openDay")}
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
}
