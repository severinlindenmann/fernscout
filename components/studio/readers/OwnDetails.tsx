"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import ContactManage, { type ManageContact } from "@/components/ContactManage";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The button that gives the owner a contact row of their own — B619.
 *
 * Everything on this page that lets a person edit their own name, telephone
 * and postal address is `ContactManage`, and it needs a row. The owner never
 * had one, so the only reader of this page who could not change anything
 * about themselves was the person whose journal it is — and a postcard, which
 * is addressed by contact id, could not be sent to them at all.
 *
 * One button rather than a form: the row is made empty and the form that
 * appears in its place is the one everybody else already gets. Nothing is
 * mailed and nothing has to be confirmed, because the session that pressed
 * this is already signed in as the address the row is for.
 *
 * It lives on this page rather than `/{user}/me` since B621: their own row is
 * one more entry in the address book, next to everybody else's.
 */
function AddOwnDetails({
  username,
  t,
  onAdded,
}: {
  username: string;
  t: (key: TranslationKey) => string;
  /** The panel's own `refresh()`. `router.refresh()` alone re-renders the
   * server component, and the contact and invite lists below are `useState`
   * seeded once from its props — so without this the new row appears in the
   * card and nowhere else until a reload. */
  onAdded: () => Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, action: "self" }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setFailed(true);
      return;
    }
    // The row now exists, so the server renders the edit form in this
    // section's place — and the lists below re-read themselves, because
    // their copy of the contacts is client state.
    await onAdded();
    router.refresh();
  }

  return (
    <div className="mt-3">
      <BusyButton
        busy={busy}
        type="button"
        onClick={add}
        className="inline-flex min-h-11 w-fit items-center rounded-full border border-line-ink px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-subtle disabled:opacity-50"
      >
        {t("me.detailsAddSelf")}
      </BusyButton>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-coral-600">{t("me.journalFailed")}</p>
      )}
    </div>
  );
}

/** The owner's own row — B621, moved off `/{user}/me`: what a postcard to
 * themselves is addressed to. Below the readers since B2133; it is not one. */
export default function OwnDetails({
  username,
  locales,
  dictionary,
  defaultCountryCode,
  addressLookupEnabled,
  own,
  t,
  onAdded,
}: {
  username: string;
  locales: string[];
  dictionary: Record<string, string>;
  defaultCountryCode?: string;
  addressLookupEnabled: boolean;
  own?: { token: string; contact: ManageContact };
  t: (key: TranslationKey) => string;
  onAdded: () => Promise<void>;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-ink-strong">{t("me.details")}</h2>
      <p className="mt-1 text-sm text-ink-body">{t("me.detailsBodyOwner")}</p>
      {own ? (
        <details className="mt-3">
          <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong transition-colors hover:bg-surface-subtle [&::-webkit-details-marker]:hidden">
            {t("me.editDetails")}
          </summary>
          <div className="mt-4 border-t border-line-quiet">
            <ContactManage
              className="pt-4"
              locales={locales}
              dictionary={dictionary}
              username={username}
              token={own.token}
              contact={own.contact}
              defaultCountryCode={defaultCountryCode}
              addressLookupEnabled={addressLookupEnabled}
              isOwner
            />
          </div>
        </details>
      ) : (
        <AddOwnDetails username={username} t={t} onAdded={onAdded} />
      )}
    </section>
  );
}
