"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import {
  History,
  PanelLeftClose,
  PanelRightClose,
  Paperclip,
  Plus,
} from "lucide-react";
import BackLink from "@/components/BackLink";
import CurrencyProvider from "@/components/CurrencyProvider";
import HelperAsk from "@/components/HelperAsk";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { InboxFileGroups } from "@/components/InboxFileGroups";
import { PhotoPicker } from "@/components/PhotoPicker";
import { DayCard } from "@/components/StoryPager";
import type { Opening as RoomOpeningState } from "@/lib/helper/opening";
import type { RoomFile, RoomFiles } from "@/lib/helper/server";
import type { CurrencyOptions } from "@/lib/rates";
import type { Day, DaySummary } from "@/lib/types";

/** Where the resizable preview column's width is remembered — B1121. Read
 *  once, on mount, and written back on every drag release. */
const PREVIEW_WIDTH_KEY = "fs.agent.previewWidth";
const PREVIEW_MIN = 380;
const PREVIEW_MAX = 440;

/**
 * The room — B901 and B902, round 4 and round 5 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * The conversation had turns, proposals and a field, and nowhere to *look*.
 * Two things were missing and they are the same missing thing twice: nothing
 * showed what was being talked about, and nothing offered the files a sentence
 * would need to talk about.
 *
 * ```
 * ┌───────────────┬────────────────────────────┬────────────────┐
 * │  FILES        │  CONVERSATION              │  PREVIEW       │
 * │  inbox        │  turns, proposals, field   │  the day card, │
 * │  this trip    │                            │  filling in    │
 * └───────────────┴────────────────────────────┴────────────────┘
 * ```
 *
 * **390px is the design width and the three columns are the wide case.** On a
 * phone the conversation is the whole screen and the other two are summoned
 * rather than laid out beside it — both as the same modal `<dialog>` sheet
 * (`Sheet`, below), opened by a press and closed by its own button. B1121's
 * two-height peek sheet is gone (B1170): it rose by itself the moment the
 * conversation named a day, inserted 112px into the layout flow under the
 * composer, and could never be dismissed. `showModal()` is what makes the
 * dialogs reachable rather than merely present: the platform's own modal
 * moves focus in, makes the rest of the page inert, closes on Escape and
 * puts focus back on the button that opened it.
 *
 * **On a laptop the same two panes are rails now, not a hide/show pair of
 * sentence buttons in the header — B1121.** Both collapse to about 40px at
 * their own edge (`FilesRail`, `PreviewColumn`) rather than vanishing
 * outright, so the way back is always in the same place. The preview also
 * grew, from a fixed 320px to 380–440px, and takes a drag handle on its own
 * left edge; its width is kept in `localStorage` across visits. The top
 * bar's right side is down to exactly two icons — a clock opening a history
 * panel (B1121 builds the shell; B1109 owns its contents) and one accent
 * button starting a new conversation.
 *
 * **Since B1016 nothing above the conversation opens either pane.** A header
 * row with two pills was chrome for things that are local: a preview is
 * about the one day a turn just named, so `HelperAsk` draws a small card
 * inside that turn (`DayChip`) and its press is what opens the preview now —
 * `onPreview`, below. Files are picked up beside the field that is about to
 * mention them, so they are a slim strip above the composer (`FilesStrip`)
 * rather than a button above the whole screen; a tap still opens the same
 * `<dialog>` `FilesPane` always has.
 *
 * **Both panes are additions and neither is a requirement.** With the files
 * pane hidden and the preview empty this is exactly the conversation B899 and
 * B900 built: `HelperAsk` takes `selected` and `onSubject` as optional props
 * and behaves identically without them, which is why it is still the same
 * component under a journal's day card.
 *
 * **Nothing here decides anything.** The pane sends ids; the server resolves
 * them against disk (`describeSelection`). The preview draws the day the
 * conversation named, from the same `GET /api/helper/<user>/day` the wizard
 * reads — the real `DayCard` with the real props, so what is wrong here is
 * wrong on the site.
 *
 * **Since B984 the files pane can also add a photograph, not only offer one.**
 * `UploadPanel`, below `FilesPane`, is `PhotoPicker` and `uploadQueue.ts` —
 * unchanged from the wizard's own use of both — aimed at whichever day the
 * conversation is about. That is the wizard's reason to exist shrinking to
 * nothing rather than a second copy of it: the day the picker writes to is
 * `subject`, the same value `PreviewPane` already reads, so the two can never
 * name different days.
 */

/** What the preview pane is currently about. `at` changes on every mention,
 *  including a second mention of the same day, which is what makes the pane
 *  re-read after a write rather than showing what it read before one. */
type Subject = { trip: string; slug: string; at: number };

type Preview = { day: Day; summary: DaySummary; dayIndex: number };

export default function HelperRoom({
  username,
  title,
  files,
  currency,
  opening,
  history = [],
  first,
  journals = [],
  consented,
  speech,
  consentedSpeech,
  speechProvider,
  whatsappNumber,
}: {
  username: string;
  /** The journal's own title, so the room says whose it is. */
  title: string;
  /** The pane's contents, read on the server — `filesForRoom`. */
  files: RoomFiles;
  /** What the day card draws money with, the same options the wizard uses. */
  currency: CurrencyOptions;
  /** The day a person arrived from (`?about=`, B994) — the one case the
   *  preview opens with something in it. Every other arrival starts with no
   *  subject: the conversation's own opening says what is waiting. B1170. */
  opening: { trip: string; slug: string } | null;
  /**
   * A conversation reopened by URL — B984, drawn from what was stored.
   *
   * **Reopening is resuming now** — B1168. The page adopts the stored
   * session into the live thread, so the next sentence continues exactly
   * the conversation on the screen and is recorded under it.
   */
  history?: { created_at: string; said: string | null; answered: string | null }[];
  /** What the room says before anybody has said anything — B984. Named apart
   *  from `opening` above, which is the *preview's* day: two different first
   *  things, and one of them is a sentence. */
  first: RoomOpeningState;
  /** Every journal this person owns — for the switcher, and only drawn when
   *  there is more than one to switch between. */
  journals?: { username: string; title: string }[];
  consented: boolean;
  speech: boolean;
  consentedSpeech: boolean;
  speechProvider: string;
  /** The wa.me number to chip in the opening — B1127. Only ever present when
   *  the server has already checked both gating facts (a proven number,
   *  `whatsappInbound` on for this journal); absent means the chip is
   *  simply not drawn. */
  whatsappNumber?: string;
}) {
  const { t } = useI18n();

  const [selected, setSelected] = useState<string[]>([]);
  /**
   * The pane's own copy of what is waiting — B915.
   *
   * It arrives from the server (`filesForRoom`) and shrinks here: a
   * photograph that has been put on a day has left the inbox, and a tile that
   * went on offering it would be offering a file that is no longer there.
   * Nothing else about the pane is decided in the browser — this is a removal
   * the server has already made, echoed rather than guessed.
   */
  const [inbox, setInbox] = useState(files.inbox);
  const [subject, setSubject] = useState<Subject | null>(
    opening ? { ...opening, at: 0 } : null,
  );
  /** Whether the field in `HelperAsk` has focus — B1016. The files strip
   *  collapses while it does: the arithmetic in B1016 is what is left of a
   *  390 × 844 phone with the keyboard up, and there is not room for both. */
  const [fieldFocused, setFieldFocused] = useState(false);
  /** Where the desktop preview column is, so an inline card's press can
   *  scroll to it rather than opening the phone's full-screen sheet over a
   *  layout that already has room for the preview — B1016. */
  const previewRef = useRef<HTMLElement>(null);
  const [scrollTick, setScrollTick] = useState(0);
  useEffect(() => {
    if (scrollTick > 0) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [scrollTick]);
  /** The last answer that came back, and which mention it answered. Kept as
   *  one value rather than as a card and a flag: "still reading" is then a
   *  comparison instead of a second piece of state to keep in step — and the
   *  card that is already up stays up while the next read is in flight, so a
   *  day being written does not blink out between two words. */
  const [landed, setLanded] = useState<{ at: number; preview: Preview | null } | null>(null);
  const preview = landed?.preview ?? null;
  const reading = subject !== null && landed?.at !== subject.at;

  /** The one photograph a turn's inline card is allowed to show without a
   *  fetch of its own — B1016. Named to the exact day it is a read of, so a
   *  card about a different day draws a marker instead of somebody else's
   *  photograph. */
  const dayPhoto =
    subject && preview
      ? { trip: subject.trip, slug: subject.slug, src: preview.day.lead.gallery[0]?.src ?? null }
      : null;

  // Desktop only: two rails a person can collapse. The conversation never
  // moves, which is the point of collapsing either.
  /**
   * The files rail collapses to about 40px **when there is nothing in it** —
   * B947, carried over from the old show/hide toggle into the new rail —
   * A designer on a laptop: it held 256px of muted placeholder on a journal
   * with an empty inbox, never changed shape, and took that width from the
   * conversation, which is the pane that matters. Her own cut, asked which
   * one thing she would remove.
   *
   * Not hidden any more — B1121 makes the rail a permanent 40px strip with a
   * count badge, so there is always a way back to it without a header
   * button. What changes is which width a person with nothing to attach
   * starts at.
   */
  const [filesCollapsed, setFilesCollapsed] = useState(
    !(files.inbox.length > 0 || files.trip.length > 0),
  );
  const [previewCollapsed, setPreviewCollapsed] = useState(false);
  /** The preview column's width, 380–440px, dragged from its own edge and
   *  kept across visits — B1121. Read once, lazily, so a server render and a
   *  browser with nothing stored both land on the same default. */
  const [previewWidth, setPreviewWidth] = useState(() => {
    if (typeof window === "undefined") return PREVIEW_MIN;
    const stored = Number(window.localStorage.getItem(PREVIEW_WIDTH_KEY));
    return stored >= PREVIEW_MIN && stored <= PREVIEW_MAX ? stored : PREVIEW_MIN;
  });
  /**
   * The divider's own drag, tracked through pointer capture rather than a
   * pair of `window` listeners — the same shape `PostcardCropper.tsx` already
   * uses. `setPointerCapture` keeps delivering `pointermove`/`pointerup` to
   * the divider even once the pointer has left it, so nothing has to be added
   * to or removed from `window` at all — and with it goes the whole class of
   * bug where a handler added at drag-start closes over a `previewWidth`
   * that is already stale by the time the pointer lifts.
   */
  const resizeStart = useRef<{ startX: number; startWidth: number } | null>(null);
  function onResizeDown(event: React.PointerEvent) {
    resizeStart.current = { startX: event.clientX, startWidth: previewWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onResizeMove(event: React.PointerEvent) {
    const drag = resizeStart.current;
    if (!drag) return;
    // The column sits to the right of the divider, so dragging left (a
    // shrinking `clientX`) is what grows it.
    const delta = drag.startX - event.clientX;
    setPreviewWidth(Math.min(PREVIEW_MAX, Math.max(PREVIEW_MIN, drag.startWidth + delta)));
  }
  function onResizeUp() {
    if (!resizeStart.current) return;
    resizeStart.current = null;
    window.localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
  }

  // The one panel that opens over the conversation at any width — B1121.
  // Its contents are B1109's; this ticket builds the button and an empty
  // shell that says so.
  const [historyOpen, setHistoryOpen] = useState(false);

  /**
   * Phone only: the files dialog, and the preview's own sheet — both plain
   * open/closed now. The preview used to *peek* by itself the moment the
   * conversation named a day (B1121), inserting 112px into the layout flow
   * and pushing the composer up as a side effect of a model answer — and it
   * could never be dismissed back to hidden. B1170: it opens on a press (a
   * turn's day chip), closes on its own button, and nothing on the phone
   * layout appears without being asked for. The day chip in the turn stays
   * as the way back in.
   */
  const [filesSheetOpen, setFilesSheetOpen] = useState(false);
  const [previewSheetOpen, setPreviewSheetOpen] = useState(false);
  /** A turn named a day while the desktop preview rail was collapsed — the
   *  rail shows a dot instead of opening itself. B1170. */
  const [previewUnseen, setPreviewUnseen] = useState(false);

  /**
   * The day, re-read whenever the conversation names one.
   *
   * `GET` only, and the same read the wizard makes; a failed read leaves the
   * pane empty and says nothing, because a preview is a courtesy and not a
   * claim — the conversation has already said what happened.
   */
  useEffect(() => {
    if (!subject) return;
    let live = true;
    const at = subject.at;
    fetch(
      `/api/helper/${encodeURIComponent(username)}/day?trip=${encodeURIComponent(subject.trip)}&slug=${encodeURIComponent(subject.slug)}`,
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { preview?: Preview } | null) => {
        if (live) setLanded({ at, preview: body?.preview ?? null });
      })
      .catch(() => {
        if (live) setLanded({ at, preview: null });
      });
    return () => {
      live = false;
    };
  }, [username, subject]);

  function toggle(id: string) {
    setSelected((was) => (was.includes(id) ? was.filter((one) => one !== id) : [...was, id]));
  }

  const filesPane = (
    <FilesPane
      files={{ ...files, inbox }}
      selected={selected}
      onToggle={toggle}
      onClear={() => setSelected([])}
      username={username}
      // What the pane's own upload just put in the inbox — B1171. Prepended,
      // because newest-first is the pane's own order, and echoed here rather
      // than re-fetched: the route answered with exactly what it stored.
      onInboxAdded={(added) => setInbox((was) => [...added, ...was])}
    />
  );

  const previewPane = (
    <PreviewPane preview={preview} reading={reading} currency={currency} />
  );

  const filesStrip = (
    <FilesStrip
      files={{ ...files, inbox }}
      selected={selected}
      collapsed={fieldFocused}
      onOpen={() => setFilesSheetOpen(true)}
    />
  );

  /**
   * `forget()` and a full navigation — B1121. This is not the "Start over"
   * link inside `HelperAsk` (that one stays; it is what a lapsed session's own
   * panel offers) but the same server call the top bar now makes reachable
   * without scrolling into the composer to find it. A full reload rather than
   * clearing local state by hand is deliberate: `HelperAsk` holds the visible
   * turns and the field, neither of which this file may reach into, so the
   * one honest way to make both start clean is the same round trip the
   * journal switcher above already takes.
   */
  async function newConversation() {
    await fetch(`/api/helper/${encodeURIComponent(username)}/ask`, { method: "DELETE" }).catch(
      () => {
        // A failed forget is not worth blocking on: the worst case is a
        // thread that outlives its clean start, not a start that fails.
      },
    );
    // `?c=new`, not bare `/agent` — B1168. A bare visit resumes whatever is
    // live, which immediately after the DELETE is nothing, but the stored
    // latest used to be redrawn and the press looked like it did nothing.
    // Naming the intent in the URL keeps "new" true however the resume
    // logic evolves.
    window.location.href = "/agent?c=new";
  }

  return (
    // The room is the whole viewport now — B1121 moved the one back link
    // `app/agent/layout.tsx` used to draw above every page here into this
    // header's own left edge, so there is no second frame to subtract.
    <div className="flex h-dvh flex-col bg-cream-100">
      <header className="flex items-center gap-2 border-b border-navy-200 bg-cream-50 px-2 py-2">
        {/* "Zurück" moves here — a chevron before the journal name rather
            than its own bar above the whole page — B1121. */}
        <BackLink
          fallbackHref="/"
          fallbackLabel={t("nav.back")}
          retraceLabel={t("nav.back")}
          showLabel={false}
          iconClassName="h-5 w-5"
          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-cream-100 hover:text-navy-900"
        />

        {/*
          The journal, and a way to change it only when there is one to change
          to — B984. A switcher on a person with one journal is a control that
          can only tell them what they already know.

          It writes a cookie and reloads: the choice has to survive a visit,
          and it must not go back into the path, which is the whole of what
          this ticket is about.
        */}
        {journals.length > 1 ? (
          // B814 — a switcher here in place of the plain title used to leave
          // the whole page with no heading at all: nothing for a screen
          // reader to jump to, on the one page that is a conversation rather
          // than a document. The `<select>` is still the visible control; this
          // just gives the page back the landing point every other one has.
          <>
            <h1 className="sr-only">{t("agent.room.title")}</h1>
            <label className="min-w-0 flex-1">
              <span className="sr-only">{t("agent.room.whichJournal")}</span>
              <select
                value={username}
                onChange={(event) => {
                  document.cookie = `fs.journal=${encodeURIComponent(event.target.value)};path=/;max-age=31536000;samesite=lax`;
                  window.location.href = "/agent";
                }}
                className="min-h-11 w-full truncate rounded-full border border-navy-300 bg-cream-50 px-3 font-display text-base font-semibold text-navy-900"
              >
                {journals.map((one) => (
                  <option key={one.username} value={one.username}>
                    {one.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-navy-900">
            {title}
          </h1>
        )}

        {/*
          Everything else that used to live here — two sentence-buttons, then
          two mobile pills (B1016) — is gone. Files and the preview each carry
          their own icon at the edge of the panel they open (`FilesRail`,
          `PreviewColumn`, below); the top right holds exactly two icons now —
          B1121.
        */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={t("agent.room.history")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-cream-100 hover:text-navy-900"
          >
            <History className="h-5 w-5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => void newConversation()}
            aria-label={t("agent.room.newConversation")}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-yellow-400 text-navy-900 transition-colors hover:bg-yellow-300"
          >
            <Plus className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left. Never drawn below `lg`: half a screen of thumbnails beside a
            conversation is the thing this layout is for not doing. */}
        <FilesRail
          collapsed={filesCollapsed}
          onToggleCollapsed={() => setFilesCollapsed((was) => !was)}
          count={files.inbox.length + files.trip.length}
          filesLabel={t("agent.room.files")}
          showLabel={t("agent.room.showFiles")}
          hideLabel={t("agent.room.hideFiles")}
        >
          {filesPane}
        </FilesRail>

        {/* Middle, and on a phone the whole of it. */}
        <main className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <HelperAsk
            username={username}
            consented={consented}
            speech={speech}
            consentedSpeech={consentedSpeech}
            speechProvider={speechProvider}
            inRoom
            opened={history}
            opening={first}
            whatsappNumber={whatsappNumber}
            selected={selected}
            onSubject={(day) => {
              setSubject({ ...day, at: Date.now() });
              // The rail says something new is behind it rather than opening
              // itself — B1170.
              if (previewCollapsed) setPreviewUnseen(true);
            }}
            onFilesMoved={(moved) => {
              // The pane's ids carry the `inbox:` prefix; the route answers
              // with the bare ids it moved.
              const gone = new Set(moved.map((id) => `inbox:${id}`));
              setInbox((was) => was.filter((file) => !gone.has(file.id)));
              setSelected((was) => was.filter((id) => !gone.has(id)));
            }}
            dayPhoto={dayPhoto}
            /**
             * A turn's inline card was pressed — B1016. "Look at it" means
             * something different depending on how much screen there is:
             * on a phone the preview's sheet opens (a modal `Sheet`, the
             * same one the files use — B1170 replaced the two-height peek
             * sheet with it); on a wider one the column opens and scrolls
             * into view. `matchMedia` is read defensively — a caller with
             * none (a test) gets the phone's own behaviour, which is the one
             * this ticket is actually about.
             */
            onPreview={(day) => {
              setSubject({ ...day, at: Date.now() });
              setPreviewUnseen(false);
              const desktop =
                typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(min-width: 1024px)").matches;
              if (desktop) {
                setPreviewCollapsed(false);
                setScrollTick((n) => n + 1);
              } else {
                setPreviewSheetOpen(true);
              }
            }}
            filesStrip={filesStrip}
            onFieldFocusChange={setFieldFocused}
          />

          {/*
            The one thing kept from the old door, at the weight it deserves —
            B984. It used to be a second yellow button, as bright as writing a
            day, for the rarest thing on the page: handing the journal to an
            agent of your own.

            A grey line at the foot, in every state. It leads to the owner's
            own page, where the keys and the handover credential already live —
            this was always a second door onto a control that has a home.
          */}
          <p className="mt-3 shrink-0 text-center">
            <a
              href={`/${encodeURIComponent(username)}/me`}
              className="text-xs text-navy-500 underline underline-offset-4 transition-colors hover:text-navy-700"
            >
              {t("agent.open.bringAgent")}
            </a>
          </p>
        </main>

        {/* Right. */}
        <PreviewColumn
          innerRef={previewRef}
          collapsed={previewCollapsed}
          unseen={previewUnseen}
          onToggleCollapsed={() => {
            setPreviewCollapsed((was) => !was);
            setPreviewUnseen(false);
          }}
          width={previewWidth}
          onResizeDown={onResizeDown}
          onResizeMove={onResizeMove}
          onResizeUp={onResizeUp}
          previewLabel={t("agent.room.preview")}
          showLabel={t("agent.room.showPreview")}
          hideLabel={t("agent.room.hidePreview")}
          resizeLabel={t("agent.room.resizePreview")}
        >
          {previewPane}
        </PreviewColumn>
      </div>

      {filesSheetOpen && (
        <Sheet
          label={t("agent.room.files")}
          close={t("agent.room.closeFiles")}
          onClose={() => setFilesSheetOpen(false)}
        >
          {filesPane}
        </Sheet>
      )}

      {/* Phone only — B1170. The same modal `Sheet` the files use, opened by
          a turn's day chip and closed by its own button. Nothing on the
          phone layout appears without being asked for. */}
      {previewSheetOpen && (
        <Sheet
          label={t("agent.room.preview")}
          close={t("agent.room.closePreview")}
          onClose={() => setPreviewSheetOpen(false)}
        >
          {previewPane}
        </Sheet>
      )}

      {historyOpen && (
        <HistoryPanel
          username={username}
          label={t("agent.room.history")}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * One thing over the conversation, on a phone — the files sheet and the
 * full-screen preview are the same object with different contents.
 *
 * A real `<dialog>`, opened with `showModal()`, for everything it gives for
 * nothing: focus moves in, the page behind goes inert, Escape closes it, and
 * focus returns to the button that opened it. The one obvious way back is a
 * button as well, because Escape is not a way back on a telephone.
 */
function Sheet({
  label,
  close,
  onClose,
  children,
}: {
  label: string;
  close: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);

  /** The platform's own close where there is one — that is what restores
   *  focus to the button that opened this, and it is why `onClose` rather
   *  than the click is what unmounts. jsdom implements neither `showModal`
   *  nor `close`, so a test drives the same exit directly. */
  const dismiss = () =>
    dialog.current?.close ? dialog.current.close() : onClose();

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      className="m-0 flex w-full max-w-none flex-col border-0 bg-cream-50 p-0 backdrop:bg-navy-900/40 fixed inset-x-0 bottom-0 top-24 max-h-none rounded-t-2xl lg:hidden"
    >
      <div className="flex items-center gap-3 border-b border-navy-200 px-4 py-2">
        {/* The handle, and it is the button: a bar somebody can only drag is a
            bar a keyboard cannot reach. Dragging it is not built — a tap
            closes, and so does Escape. */}
        <span aria-hidden className="h-1 w-10 rounded-full bg-navy-200" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{label}</p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline underline-offset-4"
        >
          {close}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </dialog>
  );
}

/**
 * The files, on a laptop, as a rail rather than a hide/show pair of sentence
 * buttons in the header — B1121.
 *
 * Collapsed is now a permanent ~40px strip carrying its own icon and a count
 * badge, never gone entirely: the toggle used to live in the header either
 * way, so this only moves it onto the edge of the thing it opens. A laptop
 * with nothing waiting starts collapsed (`filesCollapsed` in the room, B947's
 * reasoning carried over); one with something in it starts open.
 */
function FilesRail({
  collapsed,
  onToggleCollapsed,
  count,
  filesLabel,
  showLabel,
  hideLabel,
  children,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Everything in the rail, waiting or already on the trip — not the
   *  selection, which has its own live region inside `children`. */
  count: number;
  filesLabel: string;
  showLabel: string;
  hideLabel: string;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={count > 0 ? `${filesLabel} (${count})` : filesLabel}
        title={showLabel}
        className="hidden w-10 shrink-0 flex-col items-center gap-1 border-r border-navy-200 bg-cream-50 py-3 lg:flex"
      >
        <Paperclip className="h-5 w-5 text-navy-700" aria-hidden />
        {count > 0 && (
          <span
            aria-hidden
            className="min-w-[18px] rounded-full bg-navy-800 px-1 text-center text-[10px] font-semibold leading-[18px] text-cream-50"
          >
            {count}
          </span>
        )}
      </button>
    );
  }

  return (
    <section
      aria-label={filesLabel}
      className="hidden min-h-0 w-64 shrink-0 flex-col border-r border-navy-200 bg-cream-50 lg:flex"
    >
      <div className="flex shrink-0 justify-end border-b border-navy-200 p-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={hideLabel}
          title={hideLabel}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-cream-100 hover:text-navy-900"
        >
          <PanelLeftClose className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </section>
  );
}

/**
 * The preview, on a laptop — B1121. Grown from a fixed 320px column to
 * 380–440px, resizable from its own left edge, and collapsible from an icon
 * at that same edge rather than a sentence button in the header.
 *
 * The drag handle is a `role="separator"`, not a `<button>`: a `<div>` taking
 * pointer capture is what lets the room own the drag (`onResizeDown`/`Move`/
 * `Up`, tracked in `HelperRoom` itself, since a divider between two columns
 * is shared state a leaf component should not hold alone) while a keyboard
 * user still reaches the collapse button beside it, which is the operable
 * control for anyone who cannot drag.
 */
function PreviewColumn({
  innerRef,
  collapsed,
  unseen,
  onToggleCollapsed,
  width,
  onResizeDown,
  onResizeMove,
  onResizeUp,
  previewLabel,
  showLabel,
  hideLabel,
  resizeLabel,
  children,
}: {
  innerRef: React.RefObject<HTMLElement | null>;
  collapsed: boolean;
  /** A turn named a day while this rail was collapsed — drawn as a dot, so
   *  the rail says there is something new without opening itself. B1170. */
  unseen: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onResizeDown: (event: React.PointerEvent) => void;
  onResizeMove: (event: React.PointerEvent) => void;
  onResizeUp: (event: React.PointerEvent) => void;
  previewLabel: string;
  showLabel: string;
  hideLabel: string;
  resizeLabel: string;
  children: React.ReactNode;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label={showLabel}
        title={showLabel}
        className="hidden w-10 shrink-0 flex-col items-center gap-1 border-l border-navy-200 bg-cream-50 py-3 lg:flex"
      >
        <PanelRightClose className="h-5 w-5 rotate-180 text-navy-700" aria-hidden />
        {unseen && <span aria-hidden className="h-2 w-2 rounded-full bg-yellow-400" />}
      </button>
    );
  }

  return (
    <section
      ref={innerRef}
      aria-label={previewLabel}
      style={{ width: `${width}px` }}
      className="relative hidden min-h-0 shrink-0 flex-col border-l border-navy-200 bg-cream-50 lg:flex"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={resizeLabel}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none"
      />
      <div className="flex shrink-0 justify-start border-b border-navy-200 p-1">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={hideLabel}
          title={hideLabel}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-cream-100 hover:text-navy-900"
        >
          <PanelRightClose className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
    </section>
  );
}

/** One conversation, as the panel lists it — the same shape `sessionsOf`
 *  answers, read back over `GET /api/helper/<user>/sessions`. */
type SessionRow = { session: string; from: string; to: string; turns: number; opening: string };

/**
 * The clock in the top right, and what it opens — B1121 built the shell;
 * B1109 is what fills it.
 *
 * **A fetch of its own, not a prop.** Every other thing this room draws
 * arrives from the server render that made the page, but a list that changes
 * every time somebody presses "New conversation" would go stale the moment it
 * did if it were a prop instead — so this reads `GET
 * /api/helper/<user>/sessions` itself, once, when the panel opens.
 *
 * **Grouped by the day it started, oldest conversation of a day last** — the
 * same "one thing on a fixed local clock" a person's own calendar draws,
 * using `formatLongDate` rather than `toLocaleDateString` for the reason
 * `HelperConsentList.tsx` gives at length: a server render and a browser must
 * agree on what day it is.
 *
 * **A row is a link, not a button with an `onClick`.** `/agent?c=<session>`
 * is `past_conversations`' own `href` (`lib/helper/tools/areas/journal.ts`)
 * — the same address, so a conversation opened from the model's own list and
 * one opened from this panel land on exactly the same page. A full
 * navigation, matching "New conversation" a few lines above: `HelperAsk`
 * holds the turns on screen and this file may not reach into it, so the one
 * honest way to swap them is the round trip the journal switcher already
 * takes.
 */
function HistoryPanel({
  username,
  label,
  onClose,
}: {
  username: string;
  label: string;
  onClose: () => void;
}) {
  const { t, tn, formatLongDate } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal?.();
  }, []);
  const dismiss = () => (dialog.current?.close ? dialog.current.close() : onClose());

  // `null` while loading, `[]` once answered with nothing — two different
  // facts, the same distinction `said`/`answered` draws in the table itself.
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  /** The conversation a next sentence would extend, so its row can say so —
   *  B1168. `null` while loading and when nothing is in progress. */
  const [liveId, setLiveId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/helper/${encodeURIComponent(username)}/sessions`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { sessions?: SessionRow[]; live?: string | null } | null) => {
        if (live) {
          setSessions(body?.sessions ?? []);
          setLiveId(body?.live ?? null);
        }
      })
      .catch(() => {
        if (live) setSessions([]);
      });
    return () => {
      live = false;
    };
  }, [username]);

  // Newest conversation first, and within that the days themselves in the
  // order `sessionsOf` already returned them — grouping must not re-sort
  // what is already the right order.
  const days: { day: string; rows: SessionRow[] }[] = [];
  for (const row of sessions ?? []) {
    const day = row.from.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.rows.push(row);
    else days.push({ day, rows: [row] });
  }

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      className="fixed inset-0 m-0 flex h-full w-full max-w-none flex-col border-0 bg-cream-50 p-0 backdrop:bg-navy-900/40 sm:inset-y-0 sm:left-auto sm:h-full sm:w-96 sm:max-w-[90vw] sm:rounded-l-2xl"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-navy-200 px-4 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-navy-900">{label}</p>
        <button
          type="button"
          onClick={dismiss}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline underline-offset-4"
        >
          {t("agent.room.closeHistory")}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        {sessions === null ? (
          <p className="text-sm leading-6 text-navy-700">{t("agent.room.historyLoading")}</p>
        ) : days.length === 0 ? (
          <p className="text-sm leading-6 text-navy-700">{t("agent.room.historyEmpty")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            {days.map(({ day, rows }) => (
              <section key={day}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  {formatLongDate(day)}
                </h3>
                <ul className="flex flex-col gap-1">
                  {rows.map((row) => (
                    <li key={row.session}>
                      <a
                        href={`/agent?c=${encodeURIComponent(row.session)}`}
                        className="block rounded-xl border border-navy-200 bg-cream-50 px-3 py-2 transition-colors hover:bg-cream-100"
                      >
                        <p className="truncate text-sm font-medium text-navy-900">
                          {row.opening || t("agent.tool.pastConversationUntitled")}
                        </p>
                        <p className="text-xs text-navy-500">
                          {tn("agent.room.historyTurns", row.turns, { count: String(row.turns) })}
                          {row.session === liveId && (
                            <span className="ml-2 rounded-full bg-yellow-400 px-2 py-0.5 text-[11px] font-semibold text-navy-900">
                              {t("agent.room.historyLive")}
                            </span>
                          )}
                        </p>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}


/**
 * The files, as tiles that can be selected — B902.
 *
 * Two groups, because they are two different things: what is waiting and
 * belongs to no day yet, and what is already on this trip. A checkbox each,
 * labelled, so the whole pane is operated with Tab and Space and needs no
 * pointer at all — and so a screen reader says "selected" rather than leaving
 * a person to infer it from a border.
 *
 * **An inbox tile has no picture and that is not an omission.** Nothing in
 * `inbox/` is reachable by URL, by construction, and it stays that way: a file
 * nobody has filed is not published. The name is what a person recognises
 * their own file by.
 */
/**
 * A staged file whose name says it is a moving picture — B1123.
 *
 * The inbox stores a video under `kind: "media"` beside a photograph, and the
 * thumbnail route serves only still images, so a video would otherwise ask for
 * a picture that never comes. Its own extension is the one thing known here
 * without a lookup.
 */
const VIDEO = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;

function FilesPane({
  files,
  selected,
  onToggle,
  onClear,
  username,
  onInboxAdded,
}: {
  files: RoomFiles;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  username: string;
  /** The pane's upload stored these in the inbox — B1171. The room prepends
   *  them to its own copy, so the tiles appear the moment the route answers. */
  onInboxAdded: (added: RoomFile[]) => void;
}) {
  const { t, tn } = useI18n();
  const empty = files.inbox.length === 0 && files.trip.length === 0;

  return (
    <div>
      <p className="text-sm leading-6 text-navy-600">{t("agent.room.filesHint")}</p>

      {/**
       * The count is announced by a region that was **there first** — B949.
       *
       * This whole paragraph used to be behind `selected.length > 0`, so the
       * live region came into existence at the same moment as its first
       * content — and a screen reader may never announce that first change,
       * because the region was not there to be watched. Somebody ticking
       * their first photograph heard nothing, and would have had to tab
       * onward and find the "Clear" button to learn that anything had been
       * selected at all.
       *
       * The conversation log two hundred lines below has this fixed and says
       * why in the same words. The second live region on the same screen did
       * not get the same treatment, which is the whole of this ticket.
       *
       * So the `<span>` is always mounted and empty when nothing is picked;
       * only the button, which is a control rather than an announcement,
       * comes and goes.
       */}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-navy-800">
        <span role="status">
          {selected.length > 0
            ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
            : ""}
        </span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="min-h-11 px-1 text-sm text-navy-600 underline underline-offset-4 hover:text-navy-900"
          >
            {t("agent.room.clear")}
          </button>
        )}
      </p>

      {empty && <p className="mt-3 text-sm leading-6 text-navy-700">{t("agent.room.noFiles")}</p>}

      {/**
       * What is *waiting*, grouped by kind and newest first — B1123.
       *
       * This used to be one undifferentiated grid of tiles under a heading
       * saying "inbox". A photograph and a bank statement drew the same empty
       * square, and the pane led with what had been *chosen*, which a person
       * already knows, rather than what is waiting, which they do not.
       *
       * `InboxFileGroups` is the view; `filesForRoom` grew `kind`, `bytes`
       * and `uploadedAt` to feed it, and an inbox photograph's `src` now
       * points at the owner-only thumbnail route rather than being undefined.
       */}
      {files.inbox.length > 0 && (
        <InboxFileGroups
          files={files.inbox.map((file) => ({
            id: file.id,
            name: file.name,
            // The four inbox kinds collapse to the three shapes a person sees.
            // Only `media` has a picture; `files`, `photobook` and `postcards`
            // are documents and draw their type instead of an empty frame.
            kind: file.kind === "media" ? (VIDEO.test(file.name) ? "video" : "photo") : "document",
            src: file.src,
            bytes: file.bytes,
            at: file.uploadedAt,
          }))}
          selected={selected}
          onToggle={onToggle}
        />
      )}

      {files.trip.length > 0 && (
        <Group heading={t("agent.room.onTrip", { trip: files.tripTitle })}>
          {files.trip.map((file) => (
            <Tile key={file.id} file={file} on={selected.includes(file.id)} onToggle={onToggle} />
          ))}
        </Group>
      )}

      <UploadPanel username={username} onInboxAdded={onInboxAdded} />
    </div>
  );
}

/**
 * The files, as a slim strip above the composer rather than a pane above the
 * conversation — B1016.
 *
 * A header pill used to open this on a press; now it is always in view when
 * there is anything to show, about 50px tall, and a tap expands it into the
 * same `FilesPane` the pill used to open — the drawer is one mechanism, not
 * two. Mobile only (`lg:hidden`): the wide layout already has the files as
 * their own column, and a second copy of it above the composer would be a
 * pane repeating a pane.
 *
 * **Collapses while the field has focus.** The arithmetic in the ticket is
 * why: on a 390 × 844 phone with the keyboard up there is 126px left below
 * the back bar, the room header and the composer — two lines of conversation
 * with a 50px strip, and none at all with the 40% tray a literal "pane below
 * the chat" would have been.
 *
 * **Its live region is the third on this screen, and it is mounted from the
 * first render** — B949 is the record of what happens to the second one that
 * was not: created at the same moment as its first content, and a screen
 * reader may never have been watching it. So this one exists, empty, whether
 * or not there is anything to show, and says nothing until there is.
 */
function FilesStrip({
  files,
  selected,
  collapsed,
  onOpen,
}: {
  files: RoomFiles;
  selected: string[];
  /** The field in `HelperAsk` has focus. */
  collapsed: boolean;
  onOpen: () => void;
}) {
  const { t, tn } = useI18n();
  const items = [...files.inbox, ...files.trip];
  const show = items.length > 0 && !collapsed;

  return (
    <div className="lg:hidden">
      <span role="status" className="sr-only">
        {selected.length > 0
          ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
          : ""}
      </span>
      {show && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={
            selected.length > 0
              ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
              : t("agent.room.files")
          }
          className="mb-2 flex h-[50px] w-full items-center gap-1.5 overflow-x-auto rounded-xl border border-navy-200 bg-cream-50 p-1"
        >
          {items.map((file) => (
            <span
              key={file.id}
              className={`relative block h-full w-[42px] shrink-0 overflow-hidden rounded-md border bg-white ${
                selected.includes(file.id) ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200"
              }`}
            >
              {file.src ? (
                <Image src={file.src} loader={mediaLoader} alt="" fill sizes="42px" className="object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm" aria-hidden>
                  📄
                </span>
              )}
            </span>
          ))}
        </button>
      )}
    </div>
  );
}

/** What `POST /api/helper/<user>/inbox` answers with per stored file — the
 *  inbox entry as `lib/inbox.ts` wrote it. */
type StoredInboxItem = {
  id: string;
  filename: string;
  kind: RoomFile["kind"];
  bytes: number;
  uploadedAt: string;
};

/**
 * The picker and the upload — B984 put it in the room, B1171 pointed it at
 * the inbox.
 *
 * It used to write photographs straight onto whatever day the preview
 * happened to be about, which on a fresh visit was a months-old draft nobody
 * chose — and with no subject there was no upload control at all. Everything
 * lands in the inbox now, where a file that belongs to no day yet is designed
 * to wait (B663); the conversation is what files it onto a day ("put these on
 * Friday"), which keeps the one decision — what happened on which day — in
 * the conversation's hands and nowhere else.
 *
 * One request, not the wizard's two-phase queue: an inbox file needs no web
 * derivative before anybody can see the day, because it is not on a day yet.
 */
function UploadPanel({
  username,
  onInboxAdded,
}: {
  username: string;
  /** Called with the stored files, as `RoomFile`s, the moment the route
   *  answers — the pane's tiles must never claim nothing is waiting while
   *  something it just stored is. */
  onInboxAdded: (added: RoomFile[]) => void;
}) {
  const { t, tn } = useI18n();
  // The room mounts this pane twice at once — the desktop column stays in the
  // DOM behind `hidden lg:block` and the phone sheet is a second full copy —
  // so a fixed id here would put two `id="…"` inputs on one page. `useId()`
  // is React's own answer to exactly that: unique per mounted instance, and
  // stable for that instance's whole life.
  const pickerId = useId();
  const [chosen, setChosen] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [landedCount, setLandedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function upload(list: File[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    setLandedCount(0);
    // The one storage check, before any of it starts — B683: a sentence
    // somebody can act on while every photograph is still in front of them,
    // rather than a wall after the upload has already been sent.
    const room = await fetch(`/api/helper/${encodeURIComponent(username)}/day/media`).catch(
      () => null,
    );
    const check = (await room?.json().catch(() => null)) as
      | { remainingBytes: number | null }
      | null;
    if (!room || !room.ok || !check) {
      setError(t("agent.failed", { error: "network" }));
      setBusy(false);
      return;
    }
    const needed = list.reduce((n, file) => n + file.size, 0);
    const left = check.remainingBytes;
    if (left !== null && needed > left) {
      const mb = (n: number) => String(Math.max(1, Math.round(n / (1024 * 1024))));
      setError(t("agent.noRoom", { needed: mb(needed), left: mb(left) }));
      setBusy(false);
      return;
    }

    const form = new FormData();
    for (const file of list) form.append("files", file);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
      method: "POST",
      body: form,
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { items?: StoredInboxItem[]; error?: string; problems?: { expected: string }[] }
      | null;
    setBusy(false);

    if (!response || !response.ok || !body?.items) {
      // The route's own refusal names the file and what was expected; keep
      // that half rather than flattening it into a code.
      const expected = body?.problems?.[0]?.expected;
      setError(expected ?? t("agent.failed", { error: body?.error ?? "network" }));
      return;
    }

    setChosen([]);
    setLandedCount(body.items.length);
    onInboxAdded(
      body.items.map((item) => ({
        id: `inbox:${item.id}`,
        name: item.filename,
        src:
          item.kind === "media"
            ? `/api/helper/${encodeURIComponent(username)}/inbox/${encodeURIComponent(item.id)}/thumbnail`
            : undefined,
        kind: item.kind,
        bytes: item.bytes,
        uploadedAt: item.uploadedAt,
      })),
    );
  }

  return (
    <section className="mt-4 border-t border-navy-200 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
        {t("agent.uploadTitle")}
      </h2>

      <PhotoPicker
        id={pickerId}
        chosen={chosen}
        disabled={busy}
        onPick={(list) => {
          const files = Array.from(list ?? []);
          setChosen(files);
          if (files.length > 0) void upload(files);
        }}
      />

      {/* Mounted from the first render, empty until there is something to
       *  say — B949 again, in the pane that taught this file the rule the
       *  first time. A live region created at the same moment as its first
       *  content is one a screen reader may never have been watching. */}
      <p role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-navy-800">
        {busy
          ? t("agent.askWorking")
          : landedCount > 0
            ? tn("agent.room.uploadedWaiting", landedCount, { count: String(landedCount) })
            : ""}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm leading-6 text-coral-600">
          {error}
        </p>
      )}
    </section>
  );
}

function Group({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-600">{heading}</h2>
      <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">{children}</ul>
    </section>
  );
}

/** One small thumbnail, and the checkbox is the tile. The input is the label's
 *  own child and only visually hidden, so it keeps every keyboard and screen
 *  reader behaviour a checkbox has. */
function Tile({
  file,
  on,
  onToggle,
}: {
  file: RoomFile;
  on: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <li>
      <label
        className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy-800 ${
          on ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200"
        }`}
      >
        <input
          type="checkbox"
          checked={on}
          onChange={() => onToggle(file.id)}
          className="sr-only"
        />
        <span className="relative block aspect-square bg-cream-200">
          {file.src ? (
            <Image
              src={file.src}
              loader={mediaLoader}
              alt=""
              fill
              sizes="96px"
              className="object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-lg" aria-hidden>
              📄
            </span>
          )}
        </span>
        <span className="truncate px-1 py-1 text-[11px] leading-4 text-navy-800">{file.name}</span>
      </label>
    </li>
  );
}

/**
 * What is being talked about, as it now stands — B901.
 *
 * The real `DayCard`, the real props, the same read the wizard's own preview
 * step makes. Empty is the honest state and says so: a pane that invented
 * something to show would be showing a day nobody wrote.
 */
function PreviewPane({
  preview,
  reading,
  currency,
}: {
  preview: Preview | null;
  reading: boolean;
  currency: CurrencyOptions;
}) {
  const { t } = useI18n();

  if (!preview) {
    return (
      <p role="status" className="text-sm leading-6 text-navy-700">
        {reading ? t("agent.room.previewReading") : t("agent.room.previewEmpty")}
      </p>
    );
  }

  return (
    <div aria-busy={reading}>
      <CurrencyProvider options={currency}>
        <DayCard day={preview.day} summary={preview.summary} dayIndex={preview.dayIndex} />
      </CurrencyProvider>
    </div>
  );
}
