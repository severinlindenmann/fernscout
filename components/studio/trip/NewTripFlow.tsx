"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/components/LocaleProvider";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import DateField from "@/components/studio/DateField";
import DoneScreen from "@/components/studio/DoneScreen";
import { useOnline } from "@/components/studio/useOnline";
import {
  armRoute,
  disarmRoute,
  locationPermission,
  notificationPermissionStatus,
  openAppSettings,
  refreshGpsToken,
  requestLocationPermission,
  requestNotificationPermission,
  useNativeShell,
  type LocationPermission,
  type NotificationPermission,
} from "@/components/nativeShell";
import { todayISO } from "@/components/studio/location/RecordingPlan";
import { LocationAccessLine, LocationGuide } from "@/components/studio/trip/RouteRecordSection";
import { hasOutbox, newIntent, openOutboxStore } from "@/lib/outbox";
import { useStep } from "@/lib/studio/useStep";
import type { ExistingTripSummary } from "@/lib/studio/newTrip";
import type { TranslationKey } from "@/lib/i18n";
import StepBody from "@/components/studio/StepBody";
import { TripPeopleRow } from "@/components/studio/trip/TripPeopleSheet";
import type { TripPeopleSheetData } from "@/lib/studio/tripPeopleSheet";

import { journalPath } from "@/lib/journalPath";
/** One screen since B2187 — not a wizard, so no step indicator and no
 *  check list. `useStep` stays for its session draft alone (B2077): a reload
 *  keeps what was typed. The overlap notice, done and a failed write are
 *  outcomes of that screen, not steps a reload or Back should land on. */
const STEPS = ["form"] as const;
type Outcome = "overlap" | "done" | "writeFailed" | "queued";

const SKIP = "none";

/**
 * One swatch class per `ACCENTS` entry (`lib/tripWrite.ts`), written out
 * literally rather than interpolated (`` `bg-${a}-400` ``) — Tailwind's build
 * only ever picks up class names it can see as whole strings in the source,
 * and `components/SignupWizard.tsx`'s own accent picker sidesteps the same
 * trap by using plain radio labels with no swatch at all. This keeps the
 * swatch spec §7.2's storyboard actually draws, without risking a colour
 * that silently renders as nothing once the CSS is purged.
 */
export const ACCENT_SWATCH: Record<string, string> = {
  sky: "bg-sky-400",
  yellow: "bg-yellow-400",
  green: "bg-green-500",
  coral: "bg-coral-400",
  navy: "bg-navy-400",
};

/**
 * "A new trip" — B1821, spec §7.2; one screen since B2187.
 *
 * The screen asks what the server needs — a title and two dates — plus who
 * can read it, already answered "Only you" (`private`, never the journal's
 * default, which is public on a public journal). Every other question of
 * the old four-step wizard sits under "More settings", collapsed, with the
 * same defaults and the same state; opening it changes nothing that is
 * sent. A one-screen form has nothing to review, so it ends in "Create
 * trip", not in a `DecideList`. `visibilities` and
 * `accents` arrive as props rather than an import from `lib/tripWrite.ts`
 * directly — that module is `server-only`, and `components/SignupWizard.tsx`
 * already hit this same wall and left the comment explaining it; the server
 * page component (`app/at/[user]/studio/trip/new/page.tsx`) is what actually
 * imports the real lists, this only renders the ones it was handed.
 *
 * **The trap this flow exists to avoid (spec §7.2):** `POST
 * /api/helper/[user]/trip` refuses a create silent on `accent`, `tagline`,
 * `intro` and `rates` — but only once, at the moment of commit
 * (`HELPER_TRIP_DECLINE_REASONS`), never before. Skipping one of the four — or
 * never opening "More settings" at all — writes the wire sentinel `"none"`
 * rather than omitting the field, so this page can never be more permissive
 * than the chat path it replaces (`create_trip`).
 *
 * **T3! stays a pre-write confirm, never a post-write correction.** The
 * overlapping-dates notice is computed from the candidate dates against
 * `existingTrips` *before* `commit()` runs — the same "nothing is written
 * before the last step" rule the day flow's own D3 collision confirm
 * follows — rather than creating the trip first and offering to patch its
 * dates afterwards. The obvious alternative (create, then `PATCH .../trip`
 * if the person wants different dates) was tried and reverted: that route
 * carries `isEnabled("helper", …)`, which is off on a default instance —
 * exactly where this plain-form flow (B754's own reasoning on the create
 * route) is the only door — so "Change these dates" would have failed with
 * `helper_disabled` on the install this flow exists for.
 */
export default function NewTripFlow({
  username,
  visibilities,
  defaultVisibility,
  guestCount,
  guestsHref,
  existingTrips,
  otherLocales,
  initialRange,
  photoRun = null,
  peopleSheet,
}: {
  username: string;
  /** `VISIBILITIES` from `lib/tripWrite.ts`, read server-side. */
  visibilities: readonly string[];
  /** B2849 - "guest", or "public" when the journal asks to be listed. */
  defaultVisibility: string;
  /** Guests the journal already has, and where the owner sees them. */
  guestCount: number;
  guestsHref: string;
  /** For T3! — see `lib/studio/newTrip.ts`'s own doc comment. */
  existingTrips: ExistingTripSummary[];
  /** The journal's other languages: only whether there are any matters, because the old flow sent `translations: "none"` then. */
  otherLocales: string[];
  /** B2193 — `?start=&end=` from a hub day card or "start from my photos":
   *  the dates prefilled, and how many waiting photographs they span. The
   *  name is never prefilled (C7). */
  initialRange?: { start: string; end: string; photos: number };
  /** The first run of waiting photographs no trip covers, for the link. */
  photoRun?: { start: string; end: string } | null;
  /** B-2847 — what "Who's on this trip?" needs; opens once after Create. */
  peopleSheet?: TripPeopleSheetData;
}) {
  const { t, tn, locale, formatLongDate, formatShortDate, languageName: langName } = useI18n();
  const router = useRouter();

  const [title, setTitle] = useState("");
  // B2070 — an empty title is said under the field once it has been left.
  const [titleLeft, setTitleLeft] = useState(false);
  const [start, setStart] = useState(initialRange?.start ?? "");
  const [end, setEnd] = useState(initialRange?.end ?? "");
  const [visibility, setVisibility] = useState<string>(defaultVisibility);

  // B2077 — every typed answer rides in the session draft, so a reload or
  // the browser's Back keeps it. `set` trusts only the types it expects: a
  // draft is this tab's own sessionStorage, but a stale shape from an older
  // build must not crash the flow.
  const { step, reset } = useStep(STEPS, {
    flowId: `newTrip:${username}`,
    draft: {
      get: () => ({ title, start, end, visibility }),
      set: (d) => {
        if (typeof d.title === "string") setTitle(d.title);
        // Dates the owner just asked for from their photographs beat a draft's.
        if (!initialRange) {
          if (typeof d.start === "string") setStart(d.start);
          if (typeof d.end === "string") setEnd(d.end);
        }
        if (typeof d.visibility === "string" && visibilities.includes(d.visibility)) setVisibility(d.visibility);
      },
    },
  });
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [overlapWith, setOverlapWith] = useState<ExistingTripSummary | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  // B2300 — iPhone app only. "ask" is today's behaviour (the 18:00 notice the
  // evening before) and sends nothing; only "record" and "decline" call native,
  // and only once the trip exists.
  const native = useNativeShell();
  const online = useOnline();
  const [route, setRoute] = useState<"record" | "ask" | "decline">("ask");
  const [routeFrom, setRouteFrom] = useState<string | null>(null);
  const [locPermission, setLocPermission] = useState<LocationPermission | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | null>(null);
  const [locGuide, setLocGuide] = useState(false);
  useEffect(() => {
    if (!native) return;
    let live = true;
    const load = () => {
      void locationPermission().then((p) => live && setLocPermission(p), () => {});
      void notificationPermissionStatus().then((r) => live && setNotifPermission(r.status), () => {});
    };
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [native]);
  const [localToday] = useState(() => todayISO(Date.now()));
  const startedAlready = start <= localToday;
  const routeChoice = startedAlready && route === "ask" ? "undecided" : route;

  /** After the trip id returns: arm, or decline for good. A failed native
   *  call leaves the trip as made and says nothing it did not do. */
  async function applyRoute(id: string) {
    if (!native || !online) return;
    try {
      if (route === "decline") {
        await disarmRoute(id, true);
      } else if (route === "record") {
        await refreshGpsToken(username);
        const status = await armRoute({
          trip: id,
          title,
          start,
          end,
          user: username,
          stopBody: t("studio.record.notice.stopped", { title }),
          unauthorizedBody: t("studio.record.notice.unauthorized"),
          confirmTitle: t("studio.record.confirm.title", { title }),
          confirmBody: t("studio.record.confirm.body"),
          confirmRecordLabel: t("studio.record.confirm.record"),
          confirmCancelLabel: t("studio.record.confirm.cancel"),
        });
        if (status.state === "recording") setRouteFrom(startedAlready ? localToday : start);
      }
    } catch {
      // Native refused or the plugin is missing — the trip itself is made.
    }
  }

  async function commit() {
    setBusy(true);
    setWriteError(null);
    const url = `/api/helper/${encodeURIComponent(username)}/trip`;
    const payload = {
      title,
      start,
      end,
      visibility,
      // What the old flow wrote with every optional step skipped.
      accent: SKIP,
      tagline: SKIP,
      intro: SKIP,
      rates: SKIP,
      costsBudget: SKIP,
      ...(otherLocales.length > 0 ? { translations: SKIP } : {}),
      figuresMode: { mode: "journal" },
      company: "later",
    };
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; id?: string } | null;
      if (!res.ok || !json?.ok || !json.id) {
        setWriteError(t("studio.newTrip.writeFailed.message"));
        setOutcome("writeFailed");
        return;
      }
      setCreatedId(json.id);
      await applyRoute(json.id);
      setOutcome("done");
      reset();
      // B2549 — the studio's own trip list has one more trip now.
      router.refresh();
    } catch {
      // A network error (offline), not a rejection the server sent — B2330
      // queues the write itself rather than losing it, same reasoning as
      // AddDayFlow's day.new. Since B2370, a response lost after the server
      // had already written the trip is caught on replay too: the route
      // answers 409 `trip_exists` for its own base id, and `decideReplay`
      // treats that as done, the same as day.new's `date_has_day`.
      if (hasOutbox()) {
        const store = openOutboxStore();
        await store.add(newIntent({ user: username, kind: "trip.new", method: "POST", url, body: payload }));
        setOutcome("queued");
        // Not `reset()` here — it does a soft `router.replace`, which fails
        // offline the same way AddDayFlow's own queued branch explains.
        return;
      }
      setWriteError(t("studio.newTrip.writeFailed.message"));
      setOutcome("writeFailed");
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Create trip". Checks the overlapping-dates notice
   * (T3!) before anything is written; see the component doc comment above
   * for why this happens before the POST rather than after it.
   */
  function pressMakeThisTrip() {
    const overlap = existingTrips.find(
      (candidate) => candidate.status === "current" && start <= today && today <= end,
    );
    if (overlap) {
      setOverlapWith(overlap);
      setOutcome("overlap");
      return;
    }
    commit();
  }

  const titleMissing = titleLeft && !title.trim();
  const endBeforeStart = Boolean(start && end && end < start);
  const days = daysBetween(start, end);
  const whoKey = visibility === "public" ? "public" : visibility === "guest" ? "guest" : "private";

  return (
    <StepBody step={step}>

      {!outcome && (
        <div className="mt-4">
          {/* B1900 — the page's own <h1> already reads "A new trip"; this
              screen has no heading of its own. */}
          <p className="mt-2 text-sm text-ink-body">{t("studio.newTrip.gather1.lede")}</p>

          <label className="mt-4 block text-sm font-semibold text-ink-strong">
            {t("studio.newTrip.gather1.titleLabel")}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => setTitleLeft(true)}
              placeholder={t("studio.newTrip.gather1.titlePlaceholder")}
              aria-invalid={titleMissing || undefined}
              aria-describedby={titleMissing ? "new-trip-title-error" : undefined}
              className={`mt-1 block min-h-11 w-full rounded-xl border bg-surface-base px-3 text-sm text-ink-body ${titleMissing ? "border-coral-600" : "border-line-strong"}`}
            />
          </label>
          {titleMissing && (
            <p id="new-trip-title-error" role="alert" className="mt-1.5 text-sm text-coral-600">
              {t("studio.newTrip.gather1.titleNeeded")}
            </p>
          )}
          {/* B2167 — one grid, two taps: the first is the first day, the
              second the last. B1901's message still sits under the last-day
              field, for a range typed backwards. */}
          <DateField
            range={{
              start,
              end,
              onChange: (first, last) => {
                setStart(first);
                setEnd(last);
              },
              startLabel: t("studio.newTrip.gather1.startLabel"),
              endLabel: t("studio.newTrip.gather1.endLabel"),
              gridOnly: true,
            }}
          />
          <p data-range-summary aria-live="polite" className="mt-2 text-sm font-semibold text-ink-strong">
            {start && end && !endBeforeStart
              ? tn("studio.newTrip.range.summary", days, {
                  range: `${formatShortDate(start)} – ${formatShortDate(end)}`,
                  count: String(days),
                })
              : t("studio.newTrip.range.hint")}
          </p>
          <button
            type="button"
            onClick={() => {
              setStart(localToday);
              setEnd(end && end >= localToday ? end : localToday);
            }}
            className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("studio.newTrip.range.now")}
          </button>
          {initialRange && initialRange.photos > 0 && (
            <p data-from-photos className="mt-2 text-sm text-ink-secondary">
              {tn("studio.newTrip.fromPhotos.summary", initialRange.photos, {
                count: String(initialRange.photos),
                range: `${formatShortDate(initialRange.start)} – ${formatShortDate(initialRange.end)}`,
              })}
            </p>
          )}

          {native && /^\d{4}-\d{2}-\d{2}$/.test(start) && (
            <>
              {/* B2300 — the route, answered already like "Who can read it". */}
              <details data-route-choice className="mt-4 rounded-xl border border-line-strong bg-surface-raised px-4 py-3">
                <summary
                  onClick={online ? undefined : (e) => e.preventDefault()}
                  className={`flex min-h-11 list-none items-center justify-between gap-3 ${online ? "cursor-pointer" : "opacity-60"}`}
                >
                  <span>
                    <span className="block text-sm font-semibold text-ink-strong">{t("studio.newTrip.route.heading")}</span>
                    <span className="block text-sm text-ink-body">
                      {routeChoice === "undecided"
                        ? t("studio.newTrip.route.undecided")
                        : routeChoice === "record"
                          ? t(startedAlready ? "studio.newTrip.route.recordToday" : "studio.newTrip.route.record", { date: formatShortDate(start) })
                          : routeChoice === "ask"
                            ? t("studio.newTrip.route.ask")
                            : t("studio.record.notThisTrip")}
                    </span>
                  </span>
                  {online && <span className="text-sm font-semibold text-ink-body underline underline-offset-2">{t("studio.newTrip.who.change")}</span>}
                </summary>
                <div className="mt-3 flex flex-col gap-2">
                  {(startedAlready ? (["record", "decline"] as const) : (["record", "ask", "decline"] as const)).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setRoute(v)}
                      aria-pressed={routeChoice === v}
                      className={`rounded-xl border px-4 py-3 text-left ${
                        routeChoice === v ? "border-action-strong bg-surface-subtle" : "border-line-strong bg-surface-raised"
                      }`}
                    >
                      <span className="block text-sm font-semibold text-ink-strong">
                        {v === "record"
                          ? t(startedAlready ? "studio.newTrip.route.recordToday" : "studio.newTrip.route.record", { date: formatShortDate(start) })
                          : v === "ask"
                            ? t("studio.newTrip.route.ask")
                            : t("studio.record.notThisTrip")}
                      </span>
                      <span className="block text-xs text-ink-secondary">
                        {v === "record"
                          ? t(startedAlready ? "studio.newTrip.route.recordHintToday" : "studio.newTrip.route.recordHint")
                          : v === "ask"
                            ? t("studio.newTrip.route.askHint", { date: formatShortDate(new Date(Date.parse(start) - 864e5).toISOString().slice(0, 10)) })
                            : t("studio.newTrip.route.declineHint")}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
              <p className="mt-2 text-sm text-ink-secondary">
                {!online
                  ? t("studio.newTrip.route.line.offline")
                  : routeChoice === "record"
                    ? t(startedAlready ? "studio.newTrip.route.line.recordToday" : "studio.newTrip.route.line.record", { date: formatShortDate(start) })
                    : routeChoice === "ask"
                      ? t("studio.newTrip.route.line.ask", { date: formatShortDate(new Date(Date.parse(start) - 864e5).toISOString().slice(0, 10)) })
                      : routeChoice === "decline"
                        ? t("studio.newTrip.route.line.decline")
                        : t("studio.newTrip.route.line.undecided")}
              </p>
              {online && routeChoice === "record" && locPermission && !locGuide && (
                <LocationAccessLine permission={locPermission} onFix={() => setLocGuide(true)} />
              )}
              {online && routeChoice === "record" && locGuide && locPermission && (
                <div className="mt-3">
                  <LocationGuide
                    permission={locPermission}
                    busy={false}
                    doneLabel={t("studio.record.permission.done")}
                    onAsk={() => void requestLocationPermission().then(setLocPermission, () => {})}
                    onDone={() => setLocGuide(false)}
                    onCancel={() => setLocGuide(false)}
                  />
                </div>
              )}
              {online && routeChoice === "ask" && notifPermission === "unknown" && (
                <p className="mt-2 text-sm text-ink-strong">
                  {t("studio.newTrip.route.remind.ask")}{" "}
                  <button
                    type="button"
                    onClick={() => void requestNotificationPermission().then((r) => setNotifPermission(r.status), () => {})}
                    className="font-semibold underline underline-offset-2"
                  >
                    {t("studio.newTrip.route.remind.allow")}
                  </button>
                </p>
              )}
              {online && routeChoice === "ask" && notifPermission === "denied" && (
                <p className="mt-2 text-sm text-ink-strong">
                  {t("studio.newTrip.route.remind.off")}{" "}
                  <button type="button" onClick={() => void openAppSettings()} className="font-semibold underline underline-offset-2">
                    {t("studio.record.openSettings")}
                  </button>
                </p>
              )}
            </>
          )}

          {/* B2187 — who can read it, answered already: the current choice in
              plain words, the three choices one tap away. Private is the
              default whatever the journal's own default is. */}
          <details data-who-can-read className="mt-4 rounded-xl border border-line-strong bg-surface-raised px-4 py-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-semibold text-ink-strong">{t("studio.newTrip.gather1.visibilityHeading")}</span>
                <span className="block text-sm text-ink-body">
                  {t(`studio.newTrip.who.${whoKey}` as TranslationKey)}
                </span>
              </span>
              <span className="text-sm font-semibold text-ink-body underline underline-offset-2">{t("studio.newTrip.who.change")}</span>
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              {visibilities.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  aria-pressed={visibility === v}
                  className={`rounded-xl border px-4 py-3 text-left ${
                    visibility === v ? "border-action-strong bg-surface-subtle" : "border-line-strong bg-surface-raised"
                  }`}
                >
                  <span className="block text-sm font-semibold text-ink-strong">
                    {t(`studio.visibility.${v}.title` as TranslationKey)}
                  </span>
                  <span className="block text-xs text-ink-secondary">
                    {t(`studio.visibility.${v}.description` as TranslationKey)}
                  </span>
                </button>
              ))}
            </div>
          </details>
          {whoKey === "guest" && (
            <p className="mt-2 text-sm text-ink-secondary" data-guest-count>
              {guestCount === 0 ? t("studio.newTrip.who.guestsNone") : tn("studio.newTrip.who.guestsCount", guestCount, { count: String(guestCount) })}
              {guestCount > 0 && (
                <>
                  {" · "}
                  <Link href={guestsHref} className="font-semibold underline underline-offset-2">
                    {t("studio.newTrip.who.seeWho")}
                  </Link>
                </>
              )}
            </p>
          )}
          {whoKey === "public" && (
            <p role="note" data-public-warning className="mt-2 rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm font-semibold text-ink-strong">
              {t("studio.newTrip.who.publicWarning")}
            </p>
          )}
          {whoKey !== "public" && (
            <p className="mt-2 text-sm text-ink-secondary">
              {t(`studio.newTrip.who.line.${whoKey}` as TranslationKey)}
            </p>
          )}


          <div className="mt-4">
            {/* B2137: what is still missing reads as a hint until the
                primary is pressed; only a press makes it an alert. */}
            <StepPrimary
              disabled={!title.trim() || !start || !end || end < start}
              busy={busy}
              busyLabel={t("studio.newTrip.createBusy")}
              onClick={pressMakeThisTrip}
              label={t("studio.newTrip.create")}
              tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
            />
          </div>
          <p className="mt-3 text-sm text-ink-secondary">{t("studio.newTrip.decide.currentNotice")}</p>
          {photoRun && (photoRun.start !== initialRange?.start || photoRun.end !== initialRange?.end) && (
            <Link
              href={`${journalPath(username)}/studio/trip/new?start=${photoRun.start}&end=${photoRun.end}`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-body underline underline-offset-2"
            >
              {t("studio.newTrip.fromPhotos.link")}
            </Link>
          )}
          <SubmitError message={writeError} />
        </div>
      )}

      {outcome === "overlap" && overlapWith && (
        <div className="mt-4">
          <p className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm font-semibold text-ink-strong">
            {t("studio.newTrip.overlap.line")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setOutcome(null);
              }}
              className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
            >
              {t("studio.newTrip.overlap.changeDates")}
            </button>
            <StepPrimary
              busy={busy}
              busyLabel={t("studio.newTrip.createBusy")}
              onClick={commit}
              label={t("studio.newTrip.overlap.thatIsFine")}
            />
          </div>
          <SubmitError message={writeError} />
        </div>
      )}

      {outcome === "done" && createdId && (
        <>
          <DoneScreen
            username={username}
            done={t("studio.newTrip.done.banner", { title: title || t("studio.newTrip.decide.untitled") })}
          />
          {/* B2846 — one primary, in the bar; everything else a quiet row. */}
          <StepPrimary
            onClick={() => router.push(`${journalPath(username)}/studio/day/new?trip=${encodeURIComponent(createdId)}`)}
            label={t("studio.newTrip.done.addFirstDay")}
          />
          <ul className="mt-4 divide-y divide-line-quiet rounded-xl border border-line-quiet bg-surface-raised">
            {[
              { title: t("studio.newTrip.done.photos.title"), href: `${journalPath(username)}/studio/photos`, label: t("studio.newTrip.done.row.bringIn") },
              { title: t("studio.newTrip.done.settings.title"), href: `${journalPath(username)}/studio/trip?trip=${encodeURIComponent(createdId)}`, label: t("studio.newTrip.done.row.open") },
              ...(visibility !== "private"
                ? [{ title: t("studio.newTrip.done.readAlong.title"), href: `${journalPath(username)}/studio/readers#invite`, label: t("studio.newTrip.done.readAlong.cta") }]
                : []),
            ].map((row) => (
              <li key={row.href} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-ink-body">{row.title}</span>
                <Link href={row.href} className="shrink-0 font-semibold text-ink-strong underline underline-offset-2">
                  {row.label}
                </Link>
              </li>
            ))}
            {/* B-2847 — mounts once, when the trip is made: it opens by itself then, and stays a row. */}
            {peopleSheet && <TripPeopleRow
              defaultOpen
              username={username}
              tripId={createdId}
              owner={peopleSheet.owner}
              initialPeople={[]}
              contacts={peopleSheet.contacts}
              initialFigures={peopleSheet.figures}
              figureSet={peopleSheet.journalSet}
              photoConsent={peopleSheet.photoConsent}
            />}
          </ul>
          {routeFrom && (
            <p data-route-armed className="mt-2 text-sm text-ink-secondary">
              {t("studio.location.plan.recordsFrom", { date: formatShortDate(routeFrom) })}
            </p>
          )}
        </>
      )}

      {outcome === "queued" && (
        <div className="mt-4">
          <DoneScreen username={username} done={t("studio.day.queued.done")} />
          <p className="mt-2 text-sm text-ink-secondary">{t("studio.day.queued.detail")}</p>
        </div>
      )}

      {outcome === "writeFailed" && (
        <div className="mt-4">
          <SubmitError message={`${t("studio.newTrip.writeFailed.banner")} ${writeError ?? ""}`} />
          <StepPrimary onClick={() => setOutcome(null)} label={t("studio.newTrip.writeFailed.backToCheck")} />
        </div>
      )}
    </StepBody>
  );
}

/** Whole days a trip spans, inclusive of both ends; 0 when the dates cannot be read. */
function daysBetween(start: string, end: string): number {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1;
}
