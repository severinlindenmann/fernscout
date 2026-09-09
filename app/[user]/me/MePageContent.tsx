"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import {
  BookMarked,
  ChevronRight,
  Pencil,
  KeyRound,
  UserRound,
  TriangleAlert,
  ChartNoAxesColumn,
  Mailbox,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AgentHandover from "@/components/AgentHandover";
import AgentKeys from "@/components/AgentKeys";
import SessionsConsent from "@/components/SessionsConsent";
import HelperConsentList, { type ConsentRow } from "@/components/HelperConsentList";
import BuddyHandover from "@/components/BuddyHandover";
import ContactManage, { type ManageContact } from "@/components/ContactManage";
import GuestSignIn from "@/components/GuestSignIn";
import PushOptIn from "@/components/PushOptIn";
import SignOut from "@/components/SignOut";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { Viewer } from "@/lib/viewer";

/** What the "Your details" panel needs to render `ContactManage` inline —
 * everything `/c/<token>` builds server-side, handed down instead of a link
 * to that page. */
/**
 * The journal's own name and subtitle, and the address that owns it — B619.
 *
 * `PATCH /api/journal` rather than `/api/v1/{user}/config`: that one takes a
 * bearer token and this is a cookie session, which are deliberately not
 * interchangeable. The route's own comment carries the reasoning.
 *
 * The email is rendered and has no input. It is the address that decides who
 * can obtain a write token for this journal, so a stolen year-long cookie
 * must not be able to move the journal to another mailbox — the one field
 * here that is a credential rather than a label.
 */
function JournalSettings({
  username,
  journal,
}: {
  username: string;
  journal: JournalPanel;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(journal.title);
  const [tagline, setTagline] = useState(journal.tagline);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");

  const dirty =
    title.trim() !== journal.title || tagline.trim() !== journal.tagline;

  async function save() {
    setBusy(true);
    setState("idle");
    const response = await fetch("/api/journal", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, title, tagline }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setState("failed");
      return;
    }
    setState("saved");
    // The title is in the header of every page, so the whole tree has to read
    // itself again — not only this card.
    router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <label className="block">
        <span className="text-sm font-semibold text-navy-900">
          {t("me.journalName")}
        </span>
        <input
          type="text"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-navy-900">
          {t("me.journalTagline")}
        </span>
        <input
          type="text"
          value={tagline}
          maxLength={200}
          onChange={(event) => setTagline(event.target.value)}
          className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
        />
      </label>

      <div className="flex items-center gap-3">
        <BusyButton
          type="button"
          busy={busy}
          // A title cannot be cleared — `setJournalProfile` refuses it and
          // says so — and refusing the press is friendlier than a red line
          // saying what the person could see for themselves.
          disabled={!dirty || title.trim() === ""}
          onClick={save}
          className="inline-flex min-h-11 w-fit items-center rounded-full bg-navy-900 px-5 text-base font-semibold text-cream-50 transition-colors hover:bg-navy-700 disabled:opacity-50"
        >
          {t("me.journalSave")}
        </BusyButton>
        {state === "saved" && !dirty && (
          <span className="text-sm text-navy-600">{t("me.journalSaved")}</span>
        )}
        {state === "failed" && (
          <span className="text-sm text-coral-600">
            {t("me.journalFailed")}
          </span>
        )}
      </div>

      <div className="border-t border-navy-200 pt-4">
        <p className="text-sm font-semibold text-navy-900">
          {t("me.journalEmail")}
        </p>
        <p className="mt-0.5 break-words text-base text-navy-900">
          {journal.email}
        </p>
        <p className="mt-1 text-sm leading-6 text-navy-600">
          {t("me.journalEmailNote")}
        </p>
      </div>
    </div>
  );
}

/**
 * One trip in "what you can read", with the pencil that edits it — B621.
 *
 * Owner only: `edit` is undefined for everybody else and the row is exactly
 * the link it always was. A person on a trip may write days into it, and what
 * the journey is called and who may read it stays the owner's.
 *
 * The form is two halves that save separately, and that is not tidiness — the
 * route refuses a body naming both, because each call rewrites `trip.md`
 * whole. It also happens to be the right shape for the page: who may read a
 * journey is not a field you change alongside a typo in its title, so it has
 * its own control and its own second press.
 */
function TripRow({
  trip,
  edit,
  username,
  reasonKey,
}: {
  trip: Viewer["trips"][number];
  edit?: TripEditPanel;
  username: string;
  reasonKey: TranslationKey;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <li>
      <div className="flex items-center">
        <Link
          href={trip.href}
          className="flex min-h-14 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-cream-50"
        >
          <span className="flex-1">
            <span className="block font-display text-lg font-semibold text-navy-900">
              {trip.title}
            </span>
            {/* B632 — a trip may hold some of its own days back further than
                the rest of it; a row that only says "you can read this trip"
                would leave a reader thinking they are seeing all of it. */}
            {trip.partial && (
              <span className="block text-xs text-navy-500">
                {t("me.tripPartial")}
              </span>
            )}
          </span>
          <span
            className="shrink-0 self-start rounded-full bg-cream-100 px-2.5 py-1 text-xs
                       font-semibold text-navy-600"
          >
            {t(reasonKey)}
          </span>
        </Link>
        {edit && (
          <button
            type="button"
            aria-expanded={open}
            aria-label={t("me.tripEdit", { trip: trip.title })}
            onClick={() => setOpen((was) => !was)}
            // Outside the `<Link>`, not inside it: a button nested in an
            // anchor is invalid, and a click on it would navigate.
            className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600 transition-colors hover:bg-cream-100 hover:text-navy-900"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {edit && open && (
        <TripEditor
          username={username}
          trip={edit}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

function TripEditor({
  username,
  trip,
  onClose,
}: {
  username: string;
  trip: TripEditPanel;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(trip.title);
  const [tagline, setTagline] = useState(trip.tagline);
  const [start, setStart] = useState(trip.start);
  const [end, setEnd] = useState(trip.end);
  const [visibility, setVisibility] = useState(trip.visibility);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dirty =
    title.trim() !== trip.title ||
    tagline.trim() !== trip.tagline ||
    start !== trip.start ||
    end !== trip.end;

  /** One call, one kind of change — see the route. `problem` carries the
   * server's own sentence rather than a code: every refusal here already
   * explains itself in words, and rewriting them in the client would be a
   * second copy to disagree with the first. */
  async function save(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setProblem(null);
    const response = await fetch("/api/trip", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, trip: trip.id, ...body }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      const said = (await response?.json().catch(() => null)) as {
        message?: string;
      } | null;
      setProblem(said?.message ?? t("me.journalFailed"));
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="border-t border-navy-200 bg-cream-50 px-4 py-4">
      <div className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">
            {t("me.tripTitle")}
          </span>
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">
            {t("me.tripTagline")}
          </span>
          <input
            type="text"
            value={tagline}
            maxLength={300}
            onChange={(event) => setTagline(event.target.value)}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <label className="block flex-1">
            <span className="text-sm font-semibold text-navy-900">
              {t("me.tripStart")}
            </span>
            {/* `type="date"` rather than a picker: the platform has one, it is
                localised, and it is the right control on a phone. */}
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
            />
          </label>
          <label className="block flex-1">
            <span className="text-sm font-semibold text-navy-900">
              {t("me.tripEnd")}
            </span>
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <BusyButton
            busy={busy}
            type="button"
            disabled={!dirty || title.trim() === ""}
            onClick={async () => {
              if (await save({ title, tagline, start, end })) onClose();
            }}
            className="inline-flex min-h-11 w-fit items-center rounded-full bg-navy-900 px-5 text-base font-semibold text-cream-50 transition-colors hover:bg-navy-700 disabled:opacity-50"
          >
            {t("me.journalSave")}
          </BusyButton>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 w-fit items-center rounded-full px-4 text-base text-navy-700 hover:underline"
          >
            {t("me.tripCancel")}
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-navy-200 pt-4">
        <label className="block">
          <span className="text-sm font-semibold text-navy-900">
            {t("me.tripWho")}
          </span>
          <select
            value={visibility}
            onChange={(event) => {
              setVisibility(event.target.value as TripEditPanel["visibility"]);
              setConfirming(false);
            }}
            className="mt-1 block w-full rounded-xl border border-navy-500 bg-white px-3 py-2.5 text-base text-navy-900"
          >
            <option value="private">{t("me.tripWhoPrivate")}</option>
            <option value="guest">{t("me.tripWhoGuest")}</option>
            <option value="public">{t("me.tripWhoPublic")}</option>
          </select>
        </label>
        {visibility !== trip.visibility && (
          <>
            {/* Two presses, always — not only when it widens. Everything
                already published on this journey answers to the new value the
                moment it is written, and a `<select>` is one careless click. */}
            <p className="mt-2 text-sm leading-6 text-navy-700">
              {t("me.tripWhoWarning")}
            </p>
            <BusyButton
              busy={busy}
              type="button"
              onClick={async () => {
                if (!confirming) {
                  setConfirming(true);
                  return;
                }
                if (await save({ visibility })) onClose();
              }}
              className="mt-2 inline-flex min-h-11 w-fit items-center rounded-full border border-coral-400 px-5 text-base font-semibold text-coral-600 transition-colors hover:bg-coral-50 disabled:opacity-50"
            >
              {t(confirming ? "me.tripWhoConfirm" : "me.tripWhoChange")}
            </BusyButton>
          </>
        )}
      </div>

      {problem && (
        <p className="mt-3 text-sm leading-6 text-coral-600">{problem}</p>
      )}
    </div>
  );
}

/**
 * One trip as its owner may edit it — B621.
 *
 * Beside `ViewerTrip`, not inside it: that type is every reader's answer to
 * "what can I open", and three quarters of the people who get one have no
 * business being handed a trip's dates and its visibility. This is resolved
 * for the owner alone, on the server, like every other panel here.
 */
export type TripEditPanel = {
  id: string;
  title: string;
  /** `""` when the trip has none; clearing the box removes the key. */
  tagline: string;
  start: string;
  end: string;
  visibility: "public" | "guest" | "private";
};

/** The journal's own description, for the card that edits it — B619. Owner
 * only, and resolved on the server like every other panel here. */
export type JournalPanel = {
  title: string;
  /** `""` when the journal has none; clearing the box removes the key. */
  tagline: string;
  /** Shown, never edited. See `JournalSettings`. */
  email: string;
};

export type ManagePanel = {
  token: string;
  locales: string[];
  dictionary: Record<string, string>;
  contact: ManageContact;
  /** B385: `whatsappCountryCode()`, resolved server-side like everything
   * else this panel carries. */
  defaultCountryCode?: string;
  /** B399: `isEnabled("addressLookup", username)`, resolved server-side for
   * the same reason. */
  addressLookupEnabled?: boolean;
};

/**
 * "What can I see?"
 *
 * Written for the reader least comfortable with software on the site — the
 * grandmother who opens it once a month from a link in an email and, when she
 * loses the email, has no way back in. So: large type, few controls, no
 * jargon, and every line answers a question she would actually ask.
 *
 * There is no trip creation form and no entry editing, because writing
 * happens through an agent (ROADMAP decision 24) — the panel's job is to
 * tell you what to hand one, and to let you change the things that are
 * genuinely yours rather than the journal's: your own name, telephone and
 * address, and — since B619, for the owner alone — what the journal calls
 * itself. Not a day, not a photograph, not a trip. The owner's balance and
 * storage moved to their own page since B821 — see the card that links
 * there rather than showing the figures again.
 */
export default function MePageContent({
  viewer,
  username,
  siteUrl,
  manage,
  journal,
  editableTrips,
  sessionsShared = null,
  consentAgreedAt,
  consentRows = [],
  postcardCard,
  canSignIn,
  codeMinutes,
  contactsEnabled,
  analyticsEnabled = false,
  ownerName,
  signinNotice,
  hasAbout = false,
}: {
  viewer: Viewer;
  username: string;
  /** This instance's public base URL. Threaded from the server rather than
   * read off `location`, so the prompt an agent is handed names the address
   * the journal actually answers on rather than whatever host the owner
   * happens to have reached it through. */
  siteUrl: string;
  /** Present only when this reader has a contact record to edit. */
  manage?: ManagePanel;
  /** The journal's own name, subtitle and owner address — owner only, B619. */
  journal?: JournalPanel;
  /** The trips this reader may edit — B621. Owner only, and absent for
   * everybody else, which is what leaves their rows exactly as they were. */
  editableTrips?: TripEditPanel[];
  /** Whether codes can be issued at all, which is what signing in needs. */
  /** Whether the operator may read this journal's conversations, or `null`
   *  where there is no helper on it to have any — B976. */
  sessionsShared?: boolean | null;
  /** When this journal's model-facing consent was last written, and each
   *  scope it currently covers — B723. Owner only; absent (and `consentRows`
   *  empty) for everybody else and for an owner who has agreed to nothing. */
  consentAgreedAt?: string;
  consentRows?: ConsentRow[];
  /** The one postcard-shaped moment worth surfacing, if there is one right
   *  now — B436. Computed by the same function `journalStatus` reads its
   *  own `suggestions` field from (`lib/postcard/suggest.ts`), so the two
   *  can never disagree. Absent, not a card with nothing in it, the moment
   *  any of that function's conditions fails. */
  postcardCard?: { reason: string; dayHref: string };
  canSignIn: boolean;
  /** How long a code lasts, from `CODE_TTL_MINUTES` — see GuestSignIn. */
  codeMinutes: string;
  /** Whether this journal keeps a guest list at all. Resolved on the server;
   * `isEnabled` reads server config and this file is a client component. */
  contactsEnabled: boolean;
  /** Whether this journal counts its readers at all — B566. Absent rather
   * than disabled when off, per B74: a card leading to a 404 is worse than
   * no card. Only ever true for the owner, because only the owner may open
   * the page it leads to. Optional, defaulting to off, so that omitting it
   * fails towards no card rather than towards one that 404s. */
  analyticsEnabled?: boolean;
  /**
   * What to call the person whose journal this is — one word, and never their
   * address (B20).
   *
   * Picked at the server boundary by `ownerShortName`, so this component is
   * handed a name and cannot reach the email sitting beside it in the config.
   * Absent when the journal names nobody, and the copy then falls back to the
   * sentences that name no one, because "Ask ." is worse than "ask them".
   */
  ownerName?: string;
  /**
   * Why they landed here rather than inside the journal (B142).
   *
   * `?signin=expired` has been redirected to for as long as the sign-in link
   * has existed, and until now nothing on this page said anything about it —
   * so somebody whose welcome link had been spent by their own mail provider
   * arrived at an ordinary page with no explanation and every reason to think
   * they had done something wrong.
   */
  signinNotice?: string;
  /** Whether `/<user>/about` exists for this reader — B10. Absent rather
   * than a link to a 404, same rule as `analyticsEnabled` above. */
  hasAbout?: boolean;
}) {
  const { t } = useI18n();
  const site = useSite();
  // Bumped when the handover block mints a key, so the list of live keys below
  // it reads itself again rather than showing the state from page load.
  const [keysChanged, setKeysChanged] = useState(0);

  // One line beside each trip, saying why it is open to this reader. The
  // wording is `resolveViewer`'s answer and never this component's: the panel
  // computing anything of its own about access is B41.
  // A tag, not a sentence — B887. Five rows each ending "sie steht in deinem
  // Tagebuch" is the same clause five times, and it pushed every trip title
  // into two or three lines to make room for it. The reason is still
  // `resolveViewer`'s answer and never this component's (B41); only its
  // length changed. The long forms stay in the locales: `me.via*` is what
  // the trip gate says when there is one row and space to explain it.
  const reason: Record<Viewer["trips"][number]["through"], TranslationKey> = {
    public: "me.tagPublic",
    owner: "me.tagOwner",
    traveller: "me.tagTraveller",
    guest: "me.tagGuest",
  };

  /**
   * The trips this reader may *write* — B320.
   *
   * `resolveViewer` has told this page apart from B80 onwards, and until now
   * the distinction bought one sentence in the list above. It is the whole
   * answer to a second question the page never asked: somebody named in a
   * trip's `people:`, or approved through a buddy link, may write days into
   * that trip and may hold a token scoped to it. Everything on this page that
   * said so was inside `{viewer.owner && …}`, so they were told they could
   * read and nothing else.
   *
   * **Excluded for the owner, deliberately.** An owner who also travelled has
   * `traveller` trips in this list, and the block below would offer them the
   * narrow, mail-a-code flow beside their own button for a journal-wide key —
   * two ways to do one job, to a reader with no basis for choosing, which is
   * exactly what B301 removed from the owner block.
   *
   * Nothing here grants anything: this decides what to *say*, and
   * `mayRequestAgentToken` in `/api/auth/request` is still the only thing that
   * decides whether a code is issued.
   */
  const writableTrips = viewer.owner
    ? []
    : viewer.trips.filter((t) => t.through === "traveller");

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("me.title")}
        </h1>

        {/* B10 — the door to "who is behind this journal", drawn only when
            there is somewhere for it to lead (see `hasAbout` above). */}
        {hasAbout && (
          <Link
            href={`/${username}/about`}
            className="mt-2 inline-block text-base font-semibold text-navy-700 underline decoration-navy-200 decoration-2 underline-offset-4 hover:text-navy-900 hover:decoration-navy-500"
          >
            {t("about.title")}
          </Link>
        )}

        {/* First thing on the page, above the fold and above the sign-in
            control it tells them to use. It is the answer to the question they
            arrived with. */}
        {signinNotice && (
          <p
            role="status"
            className="mt-5 rounded-2xl border-l-4 border-yellow-400 bg-cream-100 py-4 pl-5 pr-4 text-lg leading-8 text-navy-900"
          >
            {t(signinNotice as never)}
          </p>
        )}

        {!viewer.email ? (
          <>
            <section className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
              <h2 className="font-display text-xl font-semibold text-navy-900">
                {t("me.strangerTitle")}
              </h2>
              {/*
                Who to ask, by name.

                The page is written for the reader least comfortable with
                software here — somebody who opens the journal from a link in
                an email and, when she loses the email, has no way back in. It
                told her the only way in was to ask a person and never said
                which person, on a site she may have reached without knowing
                whose it is.

                The name and nothing else. No address, no phone number: the
                same discipline the trip gate keeps (B117) — say enough that
                somebody who should be here knows who to write to, and nothing
                that would be a leak to whoever else tries the URL.
              */}
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {ownerName
                  ? t("me.strangerBodyNamed", { name: ownerName })
                  : t("me.strangerBody")}
              </p>

              {/*
                There is exactly one door for a stranger, and it is signing in
                — which only works for somebody already known here.

                This page used to offer the open guestbook beside it: a form
                anybody who found the address could fill in, putting themselves
                on the owner's queue uninvited (B37). It is gone, and the
                sentence that used to appear only on journals with no guestbook
                is now the honest answer for every journal: the link somebody
                sends you is what lets you in.

                It is shown only when there is nothing to press. With sign-in
                available, the reader is offered that and nothing else —
                somebody reading this has almost certainly been here before and
                lost the email, and a second paragraph telling them to ask for
                a link would talk them out of the control right underneath it.
              */}
              {!canSignIn && (
                <p className="mt-4 border-l-2 border-yellow-400 pl-4 text-base leading-7 text-navy-900">
                  {ownerName
                    ? t("me.askOwnerNamed", { name: ownerName })
                    : t("me.askOwner")}
                </p>
              )}
            </section>

            {/* The way back for somebody who has been here before and lost the
                email they were let in with. */}
            {canSignIn && (
              <GuestSignIn username={username} codeMinutes={codeMinutes} />
            )}
          </>
        ) : (
          <p className="mt-2 text-base text-navy-600">
            {t("me.signedInAs")}{" "}
            <strong className="font-semibold text-navy-900">
              {viewer.name ?? viewer.email}
            </strong>
          </p>
        )}

        {viewer.email && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.canRead")}
            </h2>
            {/*
              Three empty states, because there are three people who can
              reach one — B395 added the third.

              For somebody who has never been let in, it means the invitation
              has not arrived, and the answer is to ask whoever sent them.
              For somebody `resolveViewer` already marks `guest` — a
              confirmed contact of this journal — that sentence is false: they
              were invited and approved, and an empty list here means every
              trip is closed to them regardless, not that nobody sent them
              anything. `/<user>/trips` already told that reader the true
              thing (`trips.hiddenSignedInBody`, B264/B278); this reuses the
              same sentence rather than inventing a third wording for the same
              fact. Said to the **owner** of a journal with no trips in it at
              all, neither sentence is true — nobody sent them, and there is
              nothing to be invited to (B75).

              `resolveViewer` puts every trip in the journal into the list for
              an owner, so an empty list has exactly one meaning for them: the
              journal has no trips. The answer is how one gets made — an agent,
              per decision 24 — and the prompt to hand it is already in the
              owner block below, so the copy points down the page rather than
              repeating the handover here.
            */}
            {viewer.trips.length === 0 ? (
              <p className="mt-2 text-lg leading-8 text-navy-700">
                {viewer.owner
                  ? t("me.ownerNoTrips")
                  : viewer.guest
                    ? t("trips.hiddenSignedInBody", {
                        name: ownerName ?? username,
                      })
                    : t("me.nothing")}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-navy-200 overflow-hidden rounded-2xl border border-navy-200 bg-white">
                {viewer.trips.map((trip) => (
                  <TripRow
                    key={trip.id}
                    trip={trip}
                    edit={editableTrips?.find(
                      (candidate) => candidate.id === trip.id,
                    )}
                    username={username}
                    reasonKey={reason[trip.through]}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {/*
          Not the owner's — B621 moved theirs to `/{user}/contacts`, the page
          that is already about addresses, consents and who gets a postcard,
          where their own row is one more entry in the book rather than an
          aside on the access page. A guest has no such page and keeps it
          here, which is what it was built for.
        */}
        {manage && !viewer.owner && (
          <section className="mt-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.details")}
            </h2>
            {/*
              Two sentences, because the shorter one is false to half its
              readers — B320.

              "Nothing else on this site can be edited here — the journal is
              written by an agent" is exactly right for a guest. Said to
              somebody on a trip it reads as a closed door, and they are one of
              the people that agent writes for; it was the only thing on the
              page that addressed their write access at all, and it denied it.
              The traveller's version keeps the true half — there is still no
              form, and it is still an agent that writes — and points at the
              block that tells them how.
            */}
            <p className="mt-2 text-lg leading-8 text-navy-700">
              {/* A third reader for a paragraph that had two — B619. To the
                  owner both existing sentences are false: "the journal is
                  written by an agent" is true and is not what this section is
                  for, and the traveller's version points at a block they do
                  not have. Theirs says what the details are actually good
                  for, which is a card in their own letterbox and a message on
                  their own telephone. */}
              {t(
                writableTrips.length > 0
                  ? "me.detailsBodyTraveller"
                  : "me.detailsBody",
              )}
            </p>
            {/* A native `<details>` rather than a link to `/c/<token>`: the
                same form, opened in place instead of on a second page — see
                `ManagePanel` above for why the data now travels down instead
                of a URL. */}
            <details className="mt-3">
              <summary className="inline-flex min-h-11 w-fit cursor-pointer list-none items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 [&::-webkit-details-marker]:hidden">
                {t("me.editDetails")}
              </summary>
              <div className="mt-4 rounded-2xl border border-navy-200 bg-white">
                <ContactManage
                  className="px-5 py-6 sm:px-6"
                  locales={manage.locales}
                  dictionary={manage.dictionary}
                  username={username}
                  token={manage.token}
                  contact={manage.contact}
                  defaultCountryCode={manage.defaultCountryCode}
                  addressLookupEnabled={manage.addressLookupEnabled}
                  // B619. Their own row: the unsubscribe and delete buttons
                  // below the form promise things that are not true of the
                  // person whose journal it is — see the prop's own note.
                  isOwner={viewer.owner}
                />
              </div>
            </details>
          </section>
        )}

        {/*
          The buddy's half of the page — B320. Same place as the owner block
          below and the same shape, because it is the same job: what to hand an
          agent, and what that agent can then do. Never both, and the two
          cannot both render — `writableTrips` is empty for an owner.

          Gated on `viewer.email` only through `writableTrips`, which is empty
          for anybody not signed in, so this needs no separate check.
        */}
        {writableTrips.length > 0 && viewer.email && (
          <section className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-5 sm:p-6">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("me.buddyTitle")}
            </h2>
            <div className="mt-4">
              <BuddyHandover
                siteUrl={siteUrl}
                username={username}
                email={viewer.email}
                trips={writableTrips}
              />
              {/* B323: what B320's own warning used to say to ask the owner
                  for. A buddy sees and revokes the keys issued to their own
                  address here, without waiting on anybody else. */}
              <AgentKeys username={username} />
            </div>
          </section>
        )}

        {viewer.owner && (
          <section className="mt-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight text-navy-900">
              {t("me.ownerTitle")}
            </h2>
            <p className="mt-1.5 text-base leading-7 text-navy-600">
              {t("me.ownerLede")}
            </p>

            {/*
              Three concern-cards instead of one flat wall — B392. The owner
              block used to be a single cream box with five subsections stacked
              as identical `h3 + p + p + button` groups, so the one figure a
              person scans for (the balance) read as prose in the middle of it.
              The jobs are the agent, the money and the people; the cards say so.
            */}
            <div className="mt-5 space-y-4">
              {/*
                What the journal calls itself — B619. First of the cards
                because it is the only one about the journal rather than about
                a thing the owner hands somebody: a title typoed at signup used
                to need an agent token to correct, which is a shell away from
                needing the server.
              */}
              {journal && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <BookMarked
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                      />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.journalCardTitle")}
                    </h3>
                  </div>
                  {/*
                    Collapsed to the thing it is about — B623. Renaming a
                    journal is done once and then not again for a year, and
                    two text boxes, a Save and the email block were taking
                    that room every visit. The pencil is the shape B621's trip
                    rows already use.
                  */}
                  <details className="mt-3">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">
                        <span className="block truncate font-display text-lg font-semibold text-navy-900">
                          {journal.title}
                        </span>
                        {journal.tagline && (
                          <span className="block truncate text-sm text-navy-600">
                            {journal.tagline}
                          </span>
                        )}
                      </span>
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600">
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        {/* The disclosure's own name is the journal's title,
                            which says what it is about and not what opening it
                            does. One hidden word says the second half. */}
                        <span className="sr-only">
                          {t("me.journalCardEdit")}
                        </span>
                      </span>
                    </summary>
                    <p className="mt-3 text-base leading-7 text-navy-600">
                      {t("me.journalCardBody")}
                    </p>
                    <JournalSettings username={username} journal={journal} />
                  </details>
                </div>
              )}

              {/* The agent — handing over a key, what it can do, and the live keys. */}
              <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                    <KeyRound
                      className="h-[18px] w-[18px]"
                      aria-hidden="true"
                    />
                  </span>
                  <h3 className="font-display text-lg font-semibold text-navy-900">
                    {t("me.agentCardTitle")}
                  </h3>
                </div>

                {/* Shared with the empty trip list, which is where a new owner
                    actually lands first — see components/AgentHandover.tsx. */}
                <div className="mt-4">
                  <AgentHandover
                    username={username}
                    siteUrl={siteUrl}
                    onIssued={() => setKeysChanged((n) => n + 1)}
                  />
                </div>

                {/*
                  What the code actually becomes — the one thing a person needs
                  to judge before reading a code aloud: what the other end can
                  do, and for how long. The warning is decision 24 in a
                  sentence, and it earns the callout rather than a stray line.

                  Folded away since B623. The words are right and they are read
                  once: the first time somebody hands a key over. Left open
                  they sat between the button that mints one and the list of
                  live keys underneath, which is what an owner comes back for.
                  A `<details>` rather than state, like the details form — and
                  the summary keeps the heading, so what is behind it is named
                  rather than hidden.
                */}
                <details className="mt-5 border-t border-navy-200 pt-5">
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-display text-base font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-navy-600 transition-transform [details[open]>summary>&]:rotate-90"
                      aria-hidden="true"
                    />
                    {t("me.tokenTitle")}
                  </summary>
                  <p className="mt-1.5 text-base leading-7 text-navy-700">
                    {t("me.tokenBody")}
                  </p>
                  <div className="mt-3 flex gap-3 rounded-xl border border-coral-300 bg-coral-300/15 p-3.5">
                    <TriangleAlert
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-coral-600"
                      aria-hidden="true"
                    />
                    <p className="text-base leading-7 text-navy-900">
                      {t("me.tokenWarning")}
                    </p>
                  </div>
                </details>

                {/* The way to take a key back — B283. Renders nothing until
                    there is a live key. */}
                <AgentKeys username={username} reloadOn={keysChanged} />
              </div>

              {/*
                The door for people — B79/B282. This is a button that leads to
                the contacts panel, where links are made, listed, revoked and
                re-sent; the URL is not minted here, because a link this page
                could not show you again is a link that vanishes on the next
                navigation. Absent rather than disabled — B74 — when the journal
                has contacts off and therefore no queue for a redemption to land
                in.
              */}
              {contactsEnabled && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <UserRound
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                      />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.peopleTitle")}
                    </h3>
                  </div>
                  <p className="mt-3 text-base leading-7 text-navy-700">
                    {t("me.peopleBody")}
                  </p>
                  <Link
                    href={`${site.base}/contacts`}
                    className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("me.contacts")}
                  </Link>
                </div>
              )}
              {/*
                A postcard worth sending, if there is one right now — B436.
                Read-only: the day it points to is the thing to look at, and
                ordering the card itself is still an agent's job to compose
                (ROADMAP decision 24) — there is no button here that writes
                anything.
              */}
              {postcardCard && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <Mailbox className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.postcardCardTitle")}
                    </h3>
                  </div>
                  <p className="mt-3 text-base leading-7 text-navy-700">
                    {postcardCard.reason}
                  </p>
                  <Link
                    href={postcardCard.dayHref}
                    className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("me.postcardCardOpen")}
                  </Link>
                </div>
              )}
              {analyticsEnabled && (
                <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
                      <ChartNoAxesColumn
                        className="h-[18px] w-[18px]"
                        aria-hidden="true"
                      />
                    </span>
                    <h3 className="font-display text-lg font-semibold text-navy-900">
                      {t("me.visitorsTitle")}
                    </h3>
                  </div>
                  <p className="mt-3 text-base leading-7 text-navy-700">
                    {t("me.visitorsBody")}
                  </p>
                  <Link
                    href={`${site.base}/me/analytics`}
                    className="mt-4 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  >
                    {t("me.visitors")}
                  </Link>
                </div>
              )}
            </div>
          </section>
        )}

        {/*
          The guide that fits who this reader actually is — B445.

          `/<user>/me` is where somebody lands when they are not sure what they
          have here, so the link is aimed rather than generic: an owner is sent
          the owner's guide, somebody who was on a trip the buddy one, and
          everybody else the reader's. A menu of three would make a confused
          person choose before they know which one they are.
        */}
        <p className="mt-8">
          <Link
            href={`/docs/guide/${viewer.owner ? "creator" : writableTrips.length > 0 ? "buddy" : "guest"}`}
            className="text-base text-navy-700 underline decoration-navy-300 underline-offset-4
                       transition-colors hover:decoration-navy-700
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("guides.readMore")}
          </Link>
        </p>

        {/*
          Where notifications are switched on, for a reader who is not standing
          on a trip's landing step — B439.

          The only other switch is inside `TripHero`, which `TripStory` renders
          on the story's landing step alone: it is gone the moment somebody
          pages into a day, and a reader who resumed where they left off never
          meets it at all. This page is the one that answers "what do I have
          here, and what does it do" — see the panel above — so it is where
          somebody goes looking.

          **The heading is handed to `PushOptIn` rather than written around
          it** — B448. It used to be a `<section>` here with the control
          inside, above a comment claiming the two were conditional on the same
          answer. They were not: the control returns `null` on a browser that
          cannot subscribe and on a journal with push off, and the heading and
          its paragraph stayed — promising notifications "on this device" over
          nothing at all. Only the component knows, so only the component can
          decide, and now it renders both or neither.
        */}
        <PushOptIn
          journal={username}
          heading={{ title: t("me.notifyTitle"), lede: t("me.notifyLede") }}
        />

        {/*
          Who may read the conversations — B976, and it belongs down here.

          It sat in the owner block beside the agent card, on the grounds that
          both are about what the helper does with what you tell it. That put
          a settled default in the middle of the things somebody came to the
          page to *do* — issue a key, see who can read, rename the journal —
          and it is not one of those. It is a switch you touch once, or never.

          So: last but one, beside signing out. The two things at the foot of
          this page are now the two that are about you rather than about your
          journal, and neither is in the way of the other.
        */}
        {sessionsShared !== null && (
          <SessionsConsent username={username} shared={sessionsShared} />
        )}

        {/*
          What else this journal has agreed to send a model, and a button to
          take each back — B723, the plan's own version of the withdraw
          button that B684 put inside the wizard instead. Absent with nothing
          granted, same as the components either side of it.
        */}
        {consentAgreedAt && consentRows.length > 0 && (
          <HelperConsentList username={username} agreedAt={consentAgreedAt} rows={consentRows} />
        )}

        {/*
          Last on the page, and only when there is a session to end.

          `viewer.email` is set from the guest cookie and from nothing else, so
          it is exactly the right condition: an owner reading their own journal
          without a session, or a guest following a link token, has nothing to
          sign out of and is not offered a control that would do nothing.
        */}
        {viewer.email && <SignOut />}
      </main>
    </div>
  );
}
