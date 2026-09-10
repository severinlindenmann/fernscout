"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "./LocaleProvider";

/** What `GET .../delete` counted off the disk, for the question below. */
type Inventory = { title: string; days: number; files: number; size: string };

/**
 * The owner deleting a trip from its own page — B1321.
 *
 * One press asks the server what the trip holds, and the `ConfirmPanel` asks
 * with the inventory in the question — "12 days and 87 files (1.4 GB)" —
 * because a person recognises what they are about to lose by its size, not by
 * its id (B28). A trip that holds nothing yet — no days, nothing beyond its
 * own `trip.md` — is deleted on the first press: there is nothing to warn
 * about, and a confirmation with nothing behind it teaches people to stop
 * reading confirmations.
 */
export default function DeleteTrip({
  username,
  tripId,
}: {
  username: string;
  tripId: string;
}) {
  const { t } = useI18n();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const base = `/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/delete`;

  async function remove() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(base, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    const { redirect } = (await response.json()) as { redirect: string };
    window.location.href = redirect;
  }

  async function press() {
    setFailed(false);
    const response = await fetch(base).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    const found = (await response.json()) as Inventory;
    if (found.days === 0 && found.files <= 1) {
      await remove();
      return;
    }
    setInventory(found);
  }

  return (
    <div className="mt-3 border-t border-navy-200 pt-3">
      {inventory ? (
        <ConfirmPanel
          label={t("del.tripButton")}
          question={t("del.tripQuestion", {
            title: inventory.title,
            days: String(inventory.days),
            files: String(inventory.files),
            size: inventory.size,
          })}
          details={t("del.backups")}
          confirmLabel={t("del.deleteButton")}
          busyLabel={t("del.working")}
          busy={busy}
          error={failed ? t("del.tripFailed") : undefined}
          onConfirm={() => void remove()}
          onCancel={() => setInventory(null)}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => void press()}
            disabled={busy}
            className="text-xs font-semibold text-coral-600 underline underline-offset-2 hover:opacity-75 disabled:opacity-50"
          >
            {t("del.tripButton")}
          </button>
          {failed && (
            <p role="alert" className="mt-1 text-xs text-coral-600">
              {t("del.tripFailed")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
