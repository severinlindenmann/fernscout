"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
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
 * ## It calls the owner's own cookie doors, never a bearer one — B1674
 *
 * This runs in a browser and holds only a cookie, and every `/api/v2` door is
 * bearer-only (decision 24: a browser must never hold a credential that can
 * rewrite the site). So it calls the `/api/web` proxies instead —
 * `GET /api/web/{user}/postcards/recipients`, `GET
 * /api/web/{user}/postcards/texts` and `POST /api/web/{user}/postcards/orders`
 * — each of which checks `isOwner` on the cookie only and then calls the
 * exact function the matching `/api/v2/{user}/postcards/...` route calls
 * after its own bearer check, in process. No bearer token is ever minted,
 * held or sent by this component.
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

type Candidate = {
  contactId: string;
  name: string;
  city: string;
  country: string | null;
};

/** One day of the trip, with its opening in every language it has one in. */
type DayText = {
  slug: string;
  date: string;
  title: string;
  texts: Record<string, string>;
};

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
  /** The signature on the card. A default computed on the server — the
   * owner, then whoever else was on the trip (B629) — not a field here,
   * because it is one more box between somebody and the thing they wanted to
   * do. Correcting it is the preview page's job, or an agent's. */
  from: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  /** `null` while the round trip is in flight; the two states that stop it
   *  are the only things this component renders any more. */
  const [nobody, setNobody] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  /**
   * No form — B1500.
   *
   * This used to ask four things and then hand over to a flow that asks all
   * four again, better: the words on the Write step, the language beside
   * them, the recipients on Send. A form in front of a form, and the one
   * screen in the flow that looked like a settings dialog.
   *
   * So the tap *is* the create, and what the dialog collected are the
   * defaults it already offered: the day the photograph is from, the language
   * the journal writes in, and — because `POST …/postcards` will not take an
   * order addressed to nobody — the first person this journal may post to.
   * That last one is provisional: the Send step is where the list is chosen,
   * nothing is printed or charged before that press, and the press is the
   * only thing in this codebase that spends at a printer.
   *
   * One effect rather than three, and the navigation at the end of it. Two
   * effects filling state that a third watched for was a synchronous
   * `setState` inside an effect — a cascading render, and the linter is
   * right about it.
   */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [recRes, textRes] = await Promise.all([
          fetch(`/api/web/${username}/postcards/recipients`),
          fetch(`/api/web/${username}/postcards/texts?trip=${encodeURIComponent(trip)}`),
        ]);
        if (!live) return;

        // A failed request is not the same claim as an empty list — the
        // first means "could not find out", the second means "nobody has
        // asked". Treating a 404 as `{recipients: []}` used to render the
        // wrong one: an owner told nobody wants a postcard when the truth
        // was the door had moved (B1674). So a failed fetch here falls
        // through to the `catch` below, the same as a create failure.
        if (!recRes.ok) throw new Error(String(recRes.status));
        const rec = (await recRes.json()) as { recipients: Candidate[] };
        const to = rec.recipients[0];
        if (!to) {
          if (live) setNobody(true);
          return;
        }

        // A journal with no words on this day still gets a card: the Write
        // step is where they are written, and an empty back there is a box
        // waiting rather than a failure here.
        let message = "";
        let locale = "";
        if (textRes.ok) {
          const text = (await textRes.json()) as {
            writtenLocale: string;
            days: DayText[];
          };
          const day = text.days.find((d) => d.slug === tile.slug) ?? text.days[0];
          if (day) {
            locale = day.texts[text.writtenLocale] ? text.writtenLocale : Object.keys(day.texts)[0] ?? "";
            message = day.texts[locale] ?? "";
          }
        }
        if (!live) return;

        const res = await fetch(`/api/web/${username}/postcards/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: { trip, day: tile.slug, photo: photoPathOf(tile.src, username, trip) },
            message: message.trim(),
            from,
            recipients: [to.contactId],
            ...(locale ? { locale } : {}),
          }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const created = (await res.json()) as { url: string };
        if (!live) return;
        // `router.push`, not `window.location.assign` — B982. The order is a
        // page on this site and this was the first of four white flashes on
        // the way to posting a card.
        router.push(created.url);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [username, trip, tile.slug, tile.src, from, router, attempt]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-overlay-strong/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("postcard.title")}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-surface-raised p-5 shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-ink-strong">
            {t("postcard.title")}
          </h2>
          <button
            aria-label={t("postcard.cancel")}
            onClick={onClose}
            className="rounded-full p-1.5 text-ink-muted hover:bg-surface-neutral-strong"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {nobody ? (
          <p className="mt-4 text-sm text-ink-body">{t("postcard.noRecipients")}</p>
        ) : failed ? (
          <div className="mt-4">
            <p className="text-sm text-coral-600">{t("postcard.failed")}</p>
            <button
              onClick={() => {
                setFailed(false);
                setAttempt((n) => n + 1);
              }}
              className="mt-3 min-h-11 rounded-full border-2 border-yellow-600 bg-yellow-400 px-5 text-sm font-semibold text-yellow-950"
            >
              {t("postcard.start")}
            </button>
          </div>
        ) : (
          /* The only thing between the tap and the flow, and it is a wait
             rather than a question. */
          <p className="mt-4 text-sm text-ink-body" role="status">
            {t("postcard.creating")}
          </p>
        )}
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
export function photoPathOf(
  src: string,
  username: string,
  trip: string,
): string {
  const prefix = `/${username}/media/${trip}/`;
  return src.startsWith(prefix) ? src.slice(prefix.length) : src;
}
