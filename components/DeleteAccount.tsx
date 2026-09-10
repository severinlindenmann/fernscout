"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";

/** What `GET /<user>/me/delete` counted off the disk, for the question below. */
type Inventory = { title: string; trips: number; days: number; files: number; size: string };

/**
 * Leaving, from the page that is already about this reader — B1346.
 *
 * Beside `SignOut` and deliberately quieter than it: signing out is the
 * expensive mistake on this page, and deleting is the one that cannot be
 * undone at all. So it asks with the inventory in the question — "3 journeys,
 * 61 days and 4,200 files (2.9 GB)" — because a person recognises what they
 * are about to lose by its size rather than by its name (B28).
 *
 * **Pressing the yellow button deletes nothing**, and the copy says so twice:
 * it asks the server to send the owner's own address a link, and the button in
 * that mail is the only thing that removes anything. That is why the confirm
 * label reads "send the mail" rather than "delete" — a question whose answer
 * overstates what it does teaches people to distrust the next one.
 */
export default function DeleteAccount({ username }: { username: string }) {
  const { t } = useI18n();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [minutes, setMinutes] = useState("60");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const base = `/${encodeURIComponent(username)}/me/delete`;

  async function press() {
    setFailed(false);
    const response = await fetch(base).catch(() => null);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    setInventory((await response.json()) as Inventory);
  }

  async function ask() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(base, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    const sent = (await response.json()) as { mailedTo: string; minutes: string };
    setMinutes(sent.minutes);
    setSentTo(sent.mailedTo);
    setInventory(null);
  }

  return (
    <section className="mt-8 border-t border-navy-200 pt-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">
        {t("me.deleteTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-navy-700">{t("me.deleteBody")}</p>

      {sentTo ? (
        /* The only honest confirmation: a mail is waiting, and nothing has
           gone. It replaces the button rather than sitting under it — a second
           mail supersedes the first link (see `requestDeletion`), so offering
           to send another straight away is offering to invalidate the one they
           are about to open. */
        <p role="status" className="mt-4 text-base leading-7 text-navy-900">
          {t("me.deleteSent", { email: sentTo, minutes })}
        </p>
      ) : inventory ? (
        <div className="mt-4">
          <ConfirmPanel
            label={t("me.deleteButton")}
            question={t("me.deleteQuestion", {
              title: inventory.title,
              trips: String(inventory.trips),
              days: String(inventory.days),
              files: String(inventory.files),
              size: inventory.size,
            })}
            details={t("del.backups")}
            confirmLabel={t("me.deleteConfirm")}
            busyLabel={t("me.deleteWorking")}
            busy={busy}
            error={failed ? t("me.deleteFailed") : undefined}
            onConfirm={() => void ask()}
            onCancel={() => setInventory(null)}
          />
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => void press()}
            className="mt-4 inline-flex min-h-11 items-center rounded-full border border-coral-600 px-5 text-base font-semibold text-coral-600 transition-colors hover:bg-cream-100"
          >
            {t("me.deleteButton")}
          </button>
          <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
            {failed ? t("me.deleteFailed") : ""}
          </p>
        </>
      )}
    </section>
  );
}
