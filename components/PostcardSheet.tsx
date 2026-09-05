"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { LOCALE_LABEL } from "@/lib/i18n";
import type { MediaTile } from "@/lib/types";

/**
 * Composing a postcard from a photograph the owner is already looking at —
 * B441.
 *
 * B434 built the order and the preview page and left no way into either from
 * the site: an agent had to make one. This is the way in, and it deliberately
 * stops in the same place the agent does. **It creates a draft order and
 * redirects to the preview page. It never sends.** Sending is one button, on
 * that page, and it is the only thing anywhere that spends credits at a
 * printer — see `app/[user]/postcards/[id]/send/route.ts`.
 *
 * ## It calls the endpoints the owner already had
 *
 * `GET …/postcards/recipients`, `GET …/postcards/texts` and
 * `POST …/postcards` all authenticate through `isOwner(user, request)`, which
 * accepts the owner's session cookie as readily as an agent's bearer token —
 * so the browser is simply another owner, and every guard those routes carry
 * applies here unchanged. That is also why this component can be wrong about
 * who is allowed to see it without being dangerous: the server does not take
 * its word for anything.
 *
 * ## Why the message is prefilled from the day, and only prefilled
 *
 * The photograph is chosen and the people are a list of checkboxes; the words
 * are the only real work, and starting from a blank box at the moment somebody
 * wanted this to be easy is how a feature goes unused. So it opens with the
 * day's own beginning, trimmed to what fits on a card by `openingOf` on the
 * server side of `…/postcards/texts`.
 *
 * It is a **prefill and not a default**: the text is editable, and what gets
 * printed is whatever is in the box when the button is pressed. A journal entry
 * is written for everybody who reads the site; a postcard is read by one person
 * who knows you, and those are not the same words. The trim is a starting
 * point to correct, not a suggestion to accept.
 *
 * ## Which day, and which language — B478
 *
 * The day the photograph belongs to and the language the journal is written in
 * are where it starts, and neither is where it has to stay: `GET
 * …/postcards/texts` hands over the whole trip in every language the journal
 * keeps, and the two selects above the box are local state after that. A card
 * carries one photograph and often a week's worth of words, and a card to
 * somebody in Budapest should start from the Hungarian the day already has.
 *
 * Switching either **replaces** what is in the box, edits included. Asking for
 * another day's words is an explicit request for them, and a merge of two
 * prefills is not a thing anybody wanted. The language also travels with the
 * order — `locale` in the body — so the preview page's "usually reads another
 * language" comparison is against the language actually written, not the
 * journal's default.
 */

/** The API's own cap, repeated so the box can say so before the server does. */
const MAX_MESSAGE = 600;

type Candidate = { contactId: string; name: string; city: string; country: string | null };

/** One day of the trip, with its opening in every language it has one in. */
type DayText = { slug: string; date: string; title: string; texts: Record<string, string> };

export default function PostcardSheet({
  username,
  trip,
  tile,
  from,
  onClose,
}: {
  username: string;
  /** The trip id — the API takes the id, not the qualified ref. */
  trip: string;
  tile: MediaTile;
  /** The signature on the card. The journal's own name for its author, read
   * from `config.json` on the server — not a field here, because it is the
   * same string every time and one more box between somebody and the thing
   * they wanted to do. Correcting it is the preview page's job, or an
   * agent's. */
  from: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [creditsEach, setCreditsEach] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [days, setDays] = useState<DayText[]>([]);
  const [day, setDay] = useState(tile.slug);
  const [locale, setLocale] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(`/api/v1/${username}/postcards/recipients`);
      if (!res.ok || !live) return;
      const body = (await res.json()) as { recipients: Candidate[]; creditsEach: number };
      if (!live) return;
      setCandidates(body.recipients);
      setCreditsEach(body.creditsEach);
    })().catch(() => {
      if (live) setCandidates([]);
    });
    return () => {
      live = false;
    };
  }, [username]);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await fetch(
        `/api/v1/${username}/postcards/texts?trip=${encodeURIComponent(trip)}`,
      );
      if (!res.ok || !live) return;
      const body = (await res.json()) as { writtenLocale: string; days: DayText[] };
      if (!live) return;
      setDays(body.days);
      // The day the photograph is from, in the language the journal is written
      // in — the same two answers this component gave before there was
      // anything to choose. Either can be missing: a day whose prose is empty
      // is not offered at all, and then the first day that has words is a
      // better start than an empty box with a select pointing at nothing.
      const start = body.days.find((d) => d.slug === tile.slug) ?? body.days[0];
      if (!start) return;
      const loc = start.texts[body.writtenLocale] ? body.writtenLocale : Object.keys(start.texts)[0];
      setDay(start.slug);
      setLocale(loc);
      setMessage(start.texts[loc] ?? "");
    })().catch(() => {
      // Offline, or a journal with no days worth quoting. An empty box is a
      // fine place to start and a failure to prefill is not a failure to
      // compose.
    });
    return () => {
      live = false;
    };
  }, [username, trip, tile.slug]);

  const current = days.find((d) => d.slug === day);
  /** Only the languages this day actually has words in — see the route. */
  const languages = current ? Object.keys(current.texts) : [];

  /** Both selects do the same thing: put that day's words, in that language,
   * in the box. Written once so they cannot drift into disagreeing about
   * which of the two is the one that reloads the text. */
  function take(nextDay: string, nextLocale: string) {
    const found = days.find((d) => d.slug === nextDay);
    const loc = found?.texts[nextLocale] ? nextLocale : Object.keys(found?.texts ?? {})[0] ?? "";
    setDay(nextDay);
    setLocale(loc);
    setMessage(found?.texts[loc] ?? "");
  }

  const total = creditsEach * chosen.length;
  const ready = chosen.length > 0 && message.trim().length > 0 && !busy;

  async function create() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/v1/${username}/postcards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip,
          day: tile.slug,
          photo: photoPathOf(tile.src, username, trip),
          message: message.trim(),
          from,
          recipients: chosen,
          ...(locale ? { locale } : {}),
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { url: string };
      // Leaves this page entirely. The next thing the owner sees is the
      // preview, with the button on it — which is the handover this whole
      // component exists to perform.
      window.location.assign(body.url);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-navy-900/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("postcard.title")}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-navy-900">
            {t("postcard.title")}
          </h2>
          <button
            aria-label={t("postcard.cancel")}
            onClick={onClose}
            className="rounded-full p-1.5 text-navy-500 hover:bg-navy-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Rendered only when there is a choice to make. One day in one
            language is the common case for a journal that keeps no
            translations, and a select with a single option is furniture. */}
        {days.length > 1 || languages.length > 1 ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {days.length > 1 ? (
              <label className="text-sm font-semibold text-navy-700">
                {t("postcard.textFrom")}
                <select
                  value={day}
                  onChange={(e) => take(e.target.value, locale)}
                  className="mt-1 block rounded-lg border border-navy-200 px-2 py-1.5 text-sm font-normal text-navy-900"
                >
                  {days.map((d) => (
                    <option key={d.slug} value={d.slug}>
                      {d.date} — {d.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {languages.length > 1 ? (
              <label className="text-sm font-semibold text-navy-700">
                {t("postcard.page.writtenIn")}
                <select
                  value={locale}
                  onChange={(e) => take(day, e.target.value)}
                  className="mt-1 block rounded-lg border border-navy-200 px-2 py-1.5 text-sm font-normal text-navy-900"
                >
                  {languages.map((code) => (
                    <option key={code} value={code}>
                      {LOCALE_LABEL[code] ?? code}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="mt-4 block text-sm font-semibold text-navy-700">
          {t("postcard.messageLabel")}
          <textarea
            value={message}
            maxLength={MAX_MESSAGE}
            rows={5}
            placeholder={t("postcard.messagePlaceholder")}
            onChange={(e) => setMessage(e.target.value)}
            className="mt-1 w-full rounded-lg border border-navy-200 p-2.5 text-sm font-normal text-navy-900"
          />
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-semibold text-navy-700">
            {t("postcard.recipientsLabel")}
          </legend>
          {candidates !== null && candidates.length === 0 ? (
            <p className="mt-1 text-sm text-navy-600">{t("postcard.noRecipients")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {(candidates ?? []).map((c) => (
                <li key={c.contactId}>
                  <label className="flex items-center gap-2 text-sm text-navy-800">
                    <input
                      type="checkbox"
                      checked={chosen.includes(c.contactId)}
                      onChange={(e) =>
                        setChosen((was) =>
                          e.target.checked
                            ? [...was, c.contactId]
                            : was.filter((id) => id !== c.contactId),
                        )
                      }
                    />
                    {/* A town, never a street. The full address is behind a
                        disclosure on the preview page, which is where somebody
                        is actually checking an envelope. */}
                    {c.name} — {c.city}
                    {c.country ? `, ${c.country}` : ""}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        {failed && <p className="mt-3 text-sm text-navy-800">{t("postcard.failed")}</p>}

        <p className="mt-4 text-sm font-semibold text-navy-900">
          {t("postcard.cost", { credits: String(total) })}
        </p>
        <p className="mt-1 text-xs text-navy-600">{t("postcard.nextStep")}</p>

        <button
          onClick={create}
          disabled={!ready}
          className="mt-3 min-h-11 w-full rounded-full bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:opacity-40"
        >
          {busy ? t("postcard.creating") : t("postcard.create")}
        </button>
      </div>
    </div>
  );
}

/**
 * The tile's `src` back to a path inside the trip's media directory.
 *
 * `mediaUrl` builds `/{user}/media/{tripId}/{path}`; the order API wants the
 * `{path}`. Written as a prefix strip rather than "take everything after the
 * third slash", so a URL that is not the shape we expect returns something the
 * server will reject by name instead of a plausible-looking wrong file.
 */
export function photoPathOf(src: string, username: string, trip: string): string {
  const prefix = `/${username}/media/${trip}/`;
  return src.startsWith(prefix) ? src.slice(prefix.length) : src;
}
