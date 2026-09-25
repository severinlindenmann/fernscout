"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/** One contact the people flow filed, or who is on a trip — read on the
 *  server (`studio/people/page.tsx`) and never fetched from here. */
export type KnownPerson = { id: string; name: string | null; email: string; trips: string[] };

const ERROR_KEY: Record<string, TranslationKey> = {
  invalid_email: "contact.needEmail",
  email_taken: "contact.adminEmailTaken",
  self_authored: "studio.people.have.selfAuthored",
};

const LINK = "min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2";
const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body";

/**
 * "People you already have" — B2088. A revisit of the people page used to
 * show only the cold start. Edit and remove go through the same owner-only
 * `/api/contacts/admin` actions `/studio/readers` uses (`update`, `delete`),
 * so there is one writer for a contact, not two.
 */
export default function PeopleYouHave({ username, people }: { username: string; people: KnownPerson[] }) {
  const { t } = useI18n();
  const [rows, setRows] = useState(people);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ name: "", email: "" });
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; key: TranslationKey } | null>(null);

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, ...body }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) return true;
    const code = ((await res?.json().catch(() => null)) as { error?: string } | null)?.error;
    setError({ id: String(body.id), key: (code && ERROR_KEY[code]) || "contact.error" });
    return false;
  }

  async function save(id: string) {
    const name = draft.name.trim();
    const email = draft.email.trim();
    if (!(await post({ action: "update", id, name, email }))) return;
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name: name || null, email: email.toLowerCase() } : r)));
    setEditing(null);
  }

  async function remove(id: string) {
    if (!(await post({ action: "delete", id }))) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    setAsking(null);
  }

  return (
    <section id="people-you-have" aria-labelledby="people-you-have-h" className="mt-8">
      <h2 id="people-you-have-h" className="text-sm font-semibold uppercase tracking-wide text-ink-secondary">
        {t("studio.people.have.eyebrow")}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-body">{t("studio.people.have.empty")}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-faint rounded-xl border border-line-strong">
          {rows.map((row) => {
            const shown = row.name || row.email;
            return (
              <li key={row.id} className="px-4 py-3">
                {editing === row.id ? (
                  <div className="flex flex-col gap-2">
                    <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                      {t("studio.people.field.name")}
                      <input
                        type="text"
                        name="name"
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        className={FIELD}
                      />
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                      {t("studio.people.field.email")}
                      <input
                        type="email"
                        name="email"
                        value={draft.email}
                        onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                        className={FIELD}
                      />
                    </label>
                    <div className="flex flex-wrap items-center gap-4">
                      <BusyButton
                        type="button"
                        busy={busy}
                        onClick={() => void save(row.id)}
                        className="min-h-11 rounded-full border border-line-ink px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                      >
                        {t("contact.save")}
                      </BusyButton>
                      <button type="button" onClick={() => setEditing(null)} className={LINK}>
                        {t("contact.adminGuestCancel")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-strong">{shown}</p>
                      {row.name && <p className="break-all text-xs text-ink-secondary">{row.email}</p>}
                      <p className="text-xs text-ink-secondary">
                        {row.trips.length > 0
                          ? t("studio.people.have.onTrips", { trips: row.trips.join(", ") })
                          : t("studio.people.have.noTrip")}
                      </p>
                    </div>
                    <div className="flex gap-4">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(row.id);
                          setAsking(null);
                          setDraft({ name: row.name ?? "", email: row.email });
                        }}
                        className={LINK}
                      >
                        {t("contact.adminEdit")}
                      </button>
                      <button type="button" onClick={() => setAsking(row.id)} className={LINK}>
                        {t("studio.people.typeIn.remove")}
                      </button>
                    </div>
                  </div>
                )}
                {asking === row.id && (
                  <div className="mt-3">
                    <ConfirmPanel
                      label={t("studio.people.typeIn.remove")}
                      question={t("studio.people.have.removeQuestion", { name: shown })}
                      confirmLabel={t("contact.adminDeleteConfirm", { name: shown })}
                      tone="destructive"
                      busy={busy}
                      onConfirm={() => void remove(row.id)}
                      onCancel={() => setAsking(null)}
                    />
                  </div>
                )}
                {error?.id === row.id && (
                  <p role="alert" className="mt-2 text-sm text-coral-600">
                    {t(error.key)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
