"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The ⋯ menu on the trip and day pages — B2563 T1. One small client island
 * per page rather than a shared dropdown library: the menu itself is a
 * handful of buttons, and the only real work is the delete call, which both
 * pages already reuse the same door for (`DELETE
 * /api/helper/[user]/gps/trip`, `deleteTripRecording`) — a whole trip's
 * recording when `date` is absent, one day's when it is present.
 *
 * On the trip page (`date` absent) a "Who sees where you are" link is shown
 * first, and a successful delete sends the owner back to the routes
 * overview (there is no trip left to look at). On the day page (`date`
 * present) a successful delete sends the owner back to the trip page.
 */
export default function RouteMenu({
  username,
  tripId,
  tripTitle,
  date,
  whoSeesHref,
  backHref,
}: {
  username: string;
  tripId: string;
  tripTitle: string;
  date?: string;
  whoSeesHref?: string;
  backHref: string;
}) {
  const { t, formatShortDate } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function confirmDelete() {
    setBusy(true);
    setError(undefined);
    try {
      const q = new URLSearchParams({ trip: tripId });
      if (date) q.set("date", date);
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/gps/trip?${q}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { ok?: true } | null;
      if (!res.ok || !json?.ok) {
        setError(t("studio.location.route.deleteError"));
        return;
      }
      router.push(backHref);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={t("studio.location.menu.more")}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-lg text-ink-strong hover:bg-surface-subtle"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-12 z-10 min-w-[230px] rounded-2xl border border-line-quiet bg-surface-raised p-1 shadow-lg"
        >
          {whoSeesHref && (
            <Link
              href={whoSeesHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block min-h-11 rounded-xl px-3 py-2 text-sm font-semibold leading-[1.75rem] text-ink-strong hover:bg-surface-subtle"
            >
              {t("studio.location.tripDetail.whoSeesLink")}
            </Link>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAsking(true);
            }}
            className="block min-h-11 w-full rounded-xl px-3 py-2 text-left text-sm font-semibold leading-[1.75rem] text-coral-600 hover:bg-coral-50"
          >
            {date ? t("studio.location.route.deleteDay") : t("studio.location.route.deleteTrip")}
          </button>
        </div>
      )}
      {asking && (
        <div className="absolute right-0 top-12 z-10 w-80 max-w-[90vw]">
          <ConfirmPanel
            label={date ? t("studio.location.route.deleteDay") : t("studio.location.route.deleteTrip")}
            question={
              date
                ? t("studio.location.route.deleteDayQuestion", { date: formatShortDate(date) })
                : t("studio.location.route.deleteTripQuestion", { title: tripTitle })
            }
            details={t("studio.location.route.deleteNote")}
            confirmLabel={date ? t("studio.location.route.deleteDayConfirm") : t("studio.location.route.deleteTripConfirm")}
            tone="destructive"
            busy={busy}
            error={error}
            onConfirm={() => void confirmDelete()}
            onCancel={() => setAsking(false)}
          />
        </div>
      )}
    </div>
  );
}
