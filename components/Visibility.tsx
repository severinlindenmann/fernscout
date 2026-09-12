"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Users } from "lucide-react";
import ConfirmPanel from "./ConfirmPanel";
import VisibilityPopover from "./VisibilityPopover";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { effectiveAudience } from "@/lib/photos";
import type { Audience, PhotoVisibility, ReaderLevel } from "@/lib/photos";
import type { TranslationKey } from "@/lib/i18n";

/**
 * One vocabulary for "who may read this", at every level that has one — B1585.
 *
 * It replaces `EntryVisibilityBadge` (B632) and `PhotoVisibilityBadge` (B631),
 * which said the same thing in two components with two sets of styles, and it
 * answers the failure that made the ticket: **the owner of a live journal
 * could not tell, by looking at it, what of it was on the public internet.**
 *
 * Three rules govern everything below, and they are the ticket:
 *
 * 1. **The owner always sees a word; nobody else's page changes.** The two old
 *    badges rendered only when something had been *narrowed*, so an unmarked
 *    day meant either "no setting of its own" or "on the open internet" and
 *    there was no telling which. For the owner, absence is now impossible. For
 *    everybody else the old rule stands exactly — a `person`-level reader sees
 *    a marker on what is held back, a guest sees nothing — because a public
 *    trip must not grow chrome for the public.
 * 2. **The word is the effective audience, not the stored field.** A day with
 *    no `visibility:` of its own on a `guest` trip reads *Guests*, quietly
 *    marked as inherited. `effectiveAudience` in lib/photos.ts is the whole
 *    computation and the ordering lives there, once.
 * 3. **Two presses to change anything, always** — not only to widen. `/me`'s
 *    trip control already worked this way and says why in its own comment;
 *    B1143 asked whether the day panel deserved the same and this is the
 *    answer. Everything already published answers to the new value the moment
 *    it is written, and a `<select>` is one careless click.
 *
 * **Journal `guest` and trip `guest` are different populations**, and a shared
 * component is exactly how one word gets printed for both. At journal level
 * `guest` means *not advertised* — anyone with the link still reads the public
 * trips — while at trip level it means *the people I let into the journal*.
 * `VisibilityHelp` takes `journal` for that reason and says the difference in
 * that sentence. AGENTS.md spends four paragraphs on this trap; do not collapse
 * the two.
 */

const WORD: Record<Audience, TranslationKey> = {
  public: "visibility.public",
  guest: "visibility.guest",
  private: "visibility.private",
};

const ICON = { public: Eye, guest: Users, private: EyeOff } as const;

/**
 * Cream for open, coral for held back. The tone is the fastest half of the
 * badge to read and it must not cry wolf: a public journal is the normal case
 * and its badge is a note, while coral is the codebase's "somebody is being
 * kept out" colour and belongs only where somebody is.
 */
const TONE: Record<Audience, string> = {
  public: "border-navy-200 bg-cream-100 text-navy-700",
  guest: "border-navy-300 bg-cream-200 text-navy-900",
  private: "border-coral-600 bg-coral-100 text-navy-900",
};

/** The word alone. `overlay` is the corner of a photograph, `inline` is beside a heading. */
export function VisibilityBadge({
  audience,
  inherited,
  variant = "inline",
}: {
  audience: Audience;
  /** True when nothing at this level was set and the word comes from above. */
  inherited?: "trip" | "day" | false;
  variant?: "inline" | "overlay";
}) {
  const { t } = useI18n();
  const Icon = ICON[audience];
  const note = inherited
    ? t(inherited === "trip" ? "visibility.inheritedTrip" : "visibility.inheritedDay")
    : undefined;

  if (variant === "overlay") {
    return (
      <span
        // Dark on a photograph whatever the audience: a cream pill over a
        // bright sky is unreadable, and the tile has no room for the word to
        // be re-read. The tone is carried by the icon alone here.
        //
        // **Inherited is dimmed, and that is what makes the always-on badge
        // usable.** A public gallery is twelve tiles all saying the same
        // thing, which is twelve pills of noise the owner reads past — and
        // reading past them is exactly how the one held-back photograph gets
        // missed. Dimming the ordinary case keeps the word (absence is what
        // the ticket was about) while letting the exception carry the weight.
        className={`absolute right-1.5 top-1.5 z-10 inline-flex items-center gap-1 rounded-full
                    bg-navy-900/80 px-2 py-0.5 text-[10px] font-semibold text-white
                    ${inherited ? "opacity-50" : ""}`}
        title={note}
      >
        <Icon className="h-3 w-3" aria-hidden />
        {t(WORD[audience])}
        {note && <span className="sr-only"> — {note}</span>}
      </span>
    );
  }

  return (
    <span
      // `align-middle` and `whitespace-nowrap` keep it on a heading's baseline
      // instead of stretching the line, and stop the label wrapping away from
      // its icon when the title runs to the edge (B632).
      className={`inline-flex select-none items-center gap-1 whitespace-nowrap
                  align-middle rounded-full border px-2.5 py-0.5 font-display text-xs
                  font-semibold ${TONE[audience]} ${inherited ? "opacity-70" : ""}`}
      title={note}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {t(WORD[audience])}
      {note && <span className="sr-only"> — {note}</span>}
    </span>
  );
}

/**
 * Both triggers are 44px tall with the ink drawn small inside them — B1591,
 * and this is a rule rather than a style.
 *
 * The first attempt kept the `?` thumb-sized by spreading an invisible
 * `::after` around a small glyph. The glyph had no `position` of its own, so
 * that rectangle anchored to the nearest positioned ancestor — the whole badge
 * row — and lay on top of the badge. **Every press on a badge opened the
 * explainer instead of the chooser.** Playwright names it exactly: *"button
 * class="help" intercepts pointer events"*.
 *
 * So a trigger is genuinely the size it claims, and never a small box wearing
 * a large invisible one.
 */
const TRIGGER = "inline-flex h-11 items-center transition-transform duration-100 active:scale-[0.94]";

/**
 * The `?` — where to press, and the one fact the chooser does not already say.
 *
 * It used to repeat the three sentences that sit beside each option inside the
 * chooser, which is a glossary in two places. It now points at the badge and
 * then says what **pale** means, because that is nowhere else: a dimmed badge
 * is a thing with no setting of its own, following the trip above it.
 */
function VisibilityHelp({ journal = false }: { journal?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("visibility.help")}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={`${TRIGGER} w-8 justify-center text-navy-400 active:scale-[0.88]`}
      >
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold
                      transition-colors ${open ? "bg-navy-200 text-navy-900" : "hover:bg-navy-100 hover:text-navy-800"}`}
        >
          ?
        </span>
      </button>
      <VisibilityPopover
        open={open}
        anchor={button}
        label={t("visibility.help")}
        onClose={() => setOpen(false)}
      >
        <h4 className="font-display text-sm font-semibold text-navy-900">{t("me.tripWho")}</h4>
        <p className="mt-1.5 text-sm leading-6 text-navy-600">
          {journal ? t("visibility.journalHint") : t("visibility.hint")}
        </p>
        {/* The one place the two vocabularies are told apart. At journal level
            `guest` means only *not advertised* and grants nobody anything; at
            trip level it is a population. Saying the trip sentence here would
            be the exact mistake AGENTS.md spends four paragraphs on. */}
        <p className="mt-2.5 border-t border-navy-100 pt-2.5 text-sm leading-6 text-navy-600">
          {journal ? (
            t("visibility.journalNote")
          ) : (
            <>
              <span className="mr-1.5 align-[1px] opacity-70">
                <VisibilityBadge audience="public" inherited="trip" />
              </span>
              {t("visibility.hintPale")}
            </>
          )}
        </p>
      </VisibilityPopover>
    </>
  );
}

/**
 * The badge as a control: press it, choose, press again.
 *
 * `options` rather than a `level` discriminant, because the option *lists*
 * genuinely differ — a journal has two, a trip three, a day three of which one
 * is "as the trip says" — and a component that branched on the level four ways
 * would be four components sharing a name. What is shared, and is all that is
 * shared, is the badge, the second press and the failure line.
 *
 * `onSave` returns an error message, or null for success. It never throws: the
 * caller owns the fetch because the four levels are four different doors.
 */
function VisibilityControl({
  audience,
  inherited,
  value,
  title,
  options,
  question,
  confirmLabel,
  onSave,
  journal = false,
  children,
}: {
  audience: Audience;
  inherited?: "trip" | "day" | false;
  /** Passed straight to the `?` — the journal level's `guest` means something
   *  narrower than a trip's and its explainer has to say so. */
  journal?: boolean;
  /** The stored value at this level — "" where the level is inheriting. */
  value: string;
  /** The card's own heading: which thing is being decided about. */
  title: string;
  /** One row each. `badge` is the word this value ends up meaning; absent on
   *  the "as the trip says" row, which shows the inherited word dimmed. */
  options: { value: string; label: string; hint?: string; badge?: Audience }[];
  /** What the second press is asking, in words a reader would recognise. A
   *  function where the question depends on which way it is going — the
   *  journal's two directions have opposite consequences and one sentence
   *  covering both would be true of neither. */
  question: string | ((chosen: string) => string);
  confirmLabel: string | ((chosen: string) => string);
  onSave: (value: string) => Promise<string | null>;
  /** A trip's `listed` and `teaser`, which save through the same call. A
   *  render prop rather than a node: both are only offered for some values of
   *  the rows above them, so they have to see what is currently chosen. */
  children?: (chosen: string) => React.ReactNode;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const button = useRef<HTMLButtonElement>(null);
  // Distinct per instance, so two controls on one day cannot share a radio
  // group and silently deselect each other.
  const group = useId();

  function close() {
    setChosen(value);
    setError(undefined);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={t("visibility.change")}
        aria-expanded={open}
        onClick={(event) => {
          // The journal's badge sits inside a `<summary>`, where an unstopped
          // press toggles the disclosure it is nested in — the card would open
          // and the panel would fold shut underneath it.
          event.preventDefault();
          event.stopPropagation();
          setChosen(value);
          setError(undefined);
          setOpen((was) => !was);
        }}
        className={`${TRIGGER} rounded-full`}
      >
        <span
          className={`rounded-full transition-shadow ${
            open
              ? "shadow-[0_0_0_3px_rgba(214,155,10,0.35)]"
              : "hover:shadow-[0_0_0_3px_rgba(30,41,59,0.07)]"
          }`}
        >
          <VisibilityBadge audience={audience} inherited={inherited} />
        </span>
      </button>
      {/* Beside the badge, at every level — the question "what does Guests
          actually mean here" is asked while reading the badge, not after
          deciding to change it. Rendered by the control rather than by each
          caller, because a mount point that forgot it is a mount point with
          no explanation and nothing to say so. */}
      <VisibilityHelp journal={journal} />

      <VisibilityPopover
        open={open}
        anchor={button}
        label={t("visibility.change")}
        onClose={close}
      >
        <h4 className="font-display text-sm font-semibold text-navy-900">{title}</h4>

        <div className="mt-1.5">
          {options.map((option) => {
            const picked = chosen === option.value;
            return (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-2.5
                            ${picked ? "border-navy-300 bg-cream-100" : "border-transparent hover:bg-navy-50"}`}
              >
                <input
                  type="radio"
                  name={group}
                  value={option.value}
                  checked={picked}
                  disabled={busy}
                  onChange={() => {
                    setChosen(option.value);
                    setError(undefined);
                  }}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-navy-900">
                    {option.badge ? (
                      <VisibilityBadge audience={option.badge} />
                    ) : (
                      option.label
                    )}
                  </span>
                  {option.hint && (
                    <span className="mt-0.5 block text-xs leading-5 text-navy-600">
                      {option.hint}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>

        {children?.(chosen)}

        {/* Two presses even when the value has not moved: `children` may have
            (a trip's `listed`), and a control whose confirm disappears
            depending on which of its fields you touched is a control nobody
            trusts. The panel is inside the card now rather than under it, so
            the question and the buttons it belongs to are one thing. */}
        <div className="mt-3">
          <ConfirmPanel
            label={t("visibility.change")}
            question={typeof question === "function" ? question(chosen) : question}
            confirmLabel={
              typeof confirmLabel === "function" ? confirmLabel(chosen) : confirmLabel
            }
            busy={busy}
            error={error}
            onConfirm={async () => {
              setBusy(true);
              const failed = await onSave(chosen);
              setBusy(false);
              if (failed) {
                setError(failed);
                return;
              }
              setOpen(false);
            }}
            onCancel={close}
          />
        </div>
      </VisibilityPopover>
    </>
  );
}

/**
 * What a reader who is not the owner should see — the old B631/B632 rule,
 * unchanged and in one place now rather than duplicated in two components.
 *
 * `visible()` in lib/entries.ts has already dropped anything this reader may
 * not see; this only marks what survived, and only for somebody `readFor`
 * proved is on the trip. A guest sees nothing, which is why there is nothing
 * here to leak.
 */
function readerBadge(
  own: PhotoVisibility | undefined,
  reader: ReaderLevel | undefined,
): Audience | null {
  if (!own || reader !== "person") return null;
  return own;
}

/**
 * Why both wired controls reload the page rather than calling `router.refresh`.
 *
 * The trip's own visibility is server-rendered into `TripProvider` and a
 * refresh would reach it — but a day is not: the story pager holds its days in
 * client state, fetched from `/<user>/story.json`, and `EditDay` already
 * chose a full reload for exactly that reason. Two reload strategies for one
 * vocabulary is how one of them quietly stops working, and this happens once,
 * after a deliberate second press.
 */
function reload() {
  window.location.reload();
}

/**
 * One photograph's audience, in the corner of its tile — B1585, replacing
 * `PhotoVisibilityBadge`.
 *
 * **A label, never a control, and that is a decision rather than an
 * omission.** B1585 left it open; this is the answer. A photograph's
 * visibility is written by a `PATCH` on the *day* that carries it, and the
 * trip gallery's tiles come from every day at once — so a control here would
 * either need each tile to carry its day, or would be a second, lonelier way
 * to do what the correction panel already does with every tile of the day
 * visible side by side. What the owner was actually missing was being able to
 * *see* the state without opening anything, and that is what this fixes: the
 * old badge marked only what had been narrowed, so an unmarked tile could
 * equally have been public or simply unset.
 *
 * The change is set in `EditDay`, one select per photograph — which, until
 * B1586 was fixed on this same branch, was answering 400.
 */
export function PhotoBadge({ own }: { own?: PhotoVisibility }) {
  const trip = useTrip();
  if (!trip) return null;
  if (!trip.owner) {
    const reader = readerBadge(own, trip.reader);
    return reader ? <VisibilityBadge audience={reader} variant="overlay" /> : null;
  }
  // The day above the photograph is not in scope here — the trip gallery
  // mixes days — so the ceiling this can name is the trip's. An update that
  // holds itself back further shows that on its own heading, one line up.
  return (
    <VisibilityBadge
      audience={effectiveAudience(trip.trip.visibility, own)}
      inherited={own ? false : "trip"}
      variant="overlay"
    />
  );
}

/**
 * One update's audience, on its own heading — B1585, replacing
 * `EntryVisibilityBadge`.
 *
 * Per *update*, not per day: several updates share a date and each carries its
 * own label, which is why this hangs off the `<h2>` rather than the day.
 */
export function EntryVisibility({
  entry,
}: {
  entry: { slug: string; visibility?: PhotoVisibility };
}) {
  const { t } = useI18n();
  const trip = useTrip();
  // Null outside a `TripProvider`; there is no such caller today.
  if (!trip) return null;

  if (!trip.owner) {
    const own = readerBadge(entry.visibility, trip.reader);
    return own ? (
      <span className="ml-2 inline-block align-middle">
        <VisibilityBadge audience={own} />
      </span>
    ) : null;
  }

  return (
    <span className="ml-2 inline-block align-middle">
    <VisibilityControl
      audience={effectiveAudience(trip.trip.visibility, entry.visibility)}
      inherited={entry.visibility ? false : "trip"}
      value={entry.visibility ?? ""}
      title={t("edit.whoSees")}
      options={[
        // No `public`: a label narrows and never widens, so the trip's own
        // visibility is the ceiling and this can only sit under it (B632).
        // The first row carries no badge of its own — it is the "as the trip
        // says" choice, and giving it one would claim a setting it does not
        // make.
        { value: "", label: t("edit.seenAsTrip"), hint: t("visibility.inheritedTrip") },
        {
          value: "guest",
          label: t("visibility.guest"),
          badge: "guest",
          hint: t("agent.tool.visibilityGuest"),
        },
        {
          value: "private",
          label: t("visibility.private"),
          badge: "private",
          hint: t("agent.tool.visibilityPrivate"),
        },
      ]}
      question={t("visibility.confirmDay")}
      confirmLabel={t("me.tripWhoConfirm")}
      onSave={async (value) => {
        const response = await fetch(
          `/${encodeURIComponent(trip.trip.username)}/trips/${encodeURIComponent(
            trip.trip.id,
          )}/day/${encodeURIComponent(entry.slug)}/edit`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            // `null`, never "" — the writer reads it as "back to whatever the
            // trip says", and an empty string would be a value there is none of.
            body: JSON.stringify({ visibility: value || null }),
          },
        ).catch(() => null);
        if (!response?.ok) return t("me.journalFailed");
        reload();
        return null;
      }}
    />
    </span>
  );
}

/**
 * The journal's own word — B1591, and the one level that is not about a trip.
 *
 * It renders twice: on the card on `/me`, where the author asked for it so the
 * card answers "is my journal advertised" without being opened, and inside the
 * pencil where the checkbox used to be. **One component in both places rather
 * than a badge here and a checkbox there** — two controls for one field is how
 * they come to disagree, and the checkbox never said the word out loud anyway,
 * which was half of what B1585 set out to fix.
 *
 * Two values, and no `private`: a journal is advertised or it is not, and who
 * may read a *journey* is that trip's own gate. `visibility.journalNote`
 * carries that, because "guest" here is the same word meaning something
 * narrower than it does one level down.
 *
 * `router.refresh()` rather than the full reload the trip and day controls do:
 * this page is server-rendered with no client-held story to go stale, and a
 * reload here would throw away the panel the person is standing in.
 */
export function JournalVisibility({
  username,
  journal,
}: {
  username: string;
  journal: { visibility: "public" | "guest" };
}) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <VisibilityControl
      audience={journal.visibility}
      value={journal.visibility}
      title={t("me.journalVisibility")}
      journal
      options={[
        {
          value: "public",
          label: t("visibility.public"),
          badge: "public",
          hint: t("me.journalVisibilityHint"),
        },
        {
          value: "guest",
          label: t("visibility.guest"),
          badge: "guest",
          hint: t("visibility.journalNote"),
        },
      ]}
      question={(chosen) =>
        chosen === "public"
          ? t("me.journalVisibilityConfirmPublic")
          : t("me.journalVisibilityConfirmGuest")
      }
      confirmLabel={(chosen) =>
        chosen === "public" ? t("me.journalVisibilityGoPublic") : t("me.journalVisibilityGoGuest")
      }
      onSave={async (value) => {
        const response = await fetch("/api/journal", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user: username, visibility: value }),
        }).catch(() => null);
        if (!response?.ok) return t("me.journalFailed");
        router.refresh();
        return null;
      }}
    />
  );
}

/**
 * The trip's own gate, on the trip's own page — B1585.
 *
 * **Owner only, and absent rather than disabled for everybody else.** B117 is
 * the reason it is not merely read-only: a closed trip does not name itself to
 * anyone it has not let in, and the same discipline says it does not announce
 * how it is closed to the guests it has. The people on the trip see their own
 * days' badges; the trip's gate is the owner's.
 *
 * It carries `listed` and `teaser` because they are the rest of the answer to
 * "who can find this", and until now `listed` was reachable only by opening a
 * day's correction panel and `teaser` was reachable only over the API.
 */
export function TripVisibility() {
  const trip = useTrip();
  if (!trip?.owner) return null;
  return <TripVisibilityFor trip={trip.trip} />;
}

/**
 * The same control, for a caller with no `TripProvider` around it — B1591.
 *
 * `/me` lists every trip the owner may edit and is not inside any one trip, so
 * it cannot read the context. It had its own `<select>` and its own two-press
 * button writing to `/api/trip`, which was a second trip-visibility control
 * with a second shape and a second set of words; this is the same reasoning
 * that collapsed the journal's checkbox. One control, and `/me` gains
 * `listed` and `teaser` for free.
 */
export function TripVisibilityFor({
  trip: was,
}: {
  trip: { id: string; username: string; visibility: Audience; listed: boolean; teaser?: boolean };
}) {
  const { t } = useI18n();
  const [listed, setListed] = useState<boolean | null>(null);
  const [teaser, setTeaser] = useState<boolean | null>(null);

  const nowListed = listed ?? was.listed;
  const nowTeaser = teaser ?? was.teaser === true;

  return (
    <VisibilityControl
      audience={was.visibility}
      value={was.visibility}
      title={t("edit.tripVisibility")}
      options={[
        { value: "public", label: t("visibility.public"), badge: "public", hint: t("me.tripWhoPublic") },
        { value: "guest", label: t("visibility.guest"), badge: "guest", hint: t("me.tripWhoGuest") },
        {
          value: "private",
          label: t("visibility.private"),
          badge: "private",
          hint: t("me.tripWhoPrivate"),
        },
      ]}
      question={t("visibility.confirmTrip")}
      confirmLabel={t("me.tripWhoConfirm")}
      onSave={async (value) => {
        const response = await fetch(
          `/${encodeURIComponent(was.username)}/trips/${encodeURIComponent(was.id)}/visibility`,
          {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            // The server is still the guard: `patchTripVisibility` refuses
            // `listed: true` on a trip no visibility advertises, and `teaser`
            // on a public one. The two lines below only keep the *form* from
            // asking for a combination it already knows will be refused.
            body: JSON.stringify({
              visibility: value,
              listed: value === "public" ? nowListed : false,
              teaser: value === "public" ? false : nowTeaser,
            }),
          },
        ).catch(() => null);
        if (!response?.ok) return t("me.journalFailed");
        reload();
        return null;
      }}
    >
      {(chosen) =>
        // Under a rule, because these answer a different question from the
        // three rows above: not *who may read it* but *is it advertised*.
        <div className="mt-3 border-t border-navy-100 pt-3">
        {chosen === "public" ? (
          <label className="flex items-start gap-2.5 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={nowListed}
              onChange={(event) => setListed(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-navy-300 text-navy-900"
            />
            {t("edit.tripListed")}
          </label>
        ) : (
          <label className="flex items-start gap-2.5 text-sm text-navy-700">
            <input
              type="checkbox"
              checked={nowTeaser}
              onChange={(event) => setTeaser(event.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-navy-300 text-navy-900"
            />
            <span>
              {t("visibility.teaser")}
              <span className="block text-xs text-navy-500">{t("visibility.teaserHint")}</span>
            </span>
          </label>
        )}
        </div>
      }
    </VisibilityControl>
  );
}
