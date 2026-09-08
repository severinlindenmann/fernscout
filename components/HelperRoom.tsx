"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import CurrencyProvider from "@/components/CurrencyProvider";
import HelperAsk from "@/components/HelperAsk";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { PhotoPicker } from "@/components/PhotoPicker";
import { DayCard } from "@/components/StoryPager";
import { drain, enqueue, type QueueProgress } from "@/components/uploadQueue";
import type { Opening as RoomOpeningState } from "@/lib/helper/opening";
import type { RoomFile, RoomFiles } from "@/lib/helper/server";
import type { CurrencyOptions } from "@/lib/rates";
import type { Day, DaySummary } from "@/lib/types";

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
 * phone the conversation is the whole screen and the other two are modal
 * `<dialog>`s over it — files up from the bottom, the preview full screen —
 * so nothing is ever half a screen wide. `showModal()` is what makes those two
 * reachable rather than merely present: the platform's own modal moves focus
 * in, makes the rest of the page inert, closes on Escape and puts focus back
 * on the button that opened it, and every one of those is checklist D asking
 * for something a hand-rolled overlay would have to earn again.
 *
 * **Since B1016 nothing above the conversation opens either dialog.** A
 * header row with two pills was chrome for things that are local: a preview
 * is about the one day a turn just named, so `HelperAsk` draws a small card
 * inside that turn (`DayChip`) and its press is what opens the full-screen
 * sheet now — `onPreview`, below. Files are picked up beside the field that
 * is about to mention them, so they are a slim strip above the composer
 * (`FilesStrip`) rather than a button above the whole screen; a tap still
 * opens the same `<dialog>` `FilesPane` always has. The dialogs and their
 * focus behaviour are unchanged — only what opens them moved into the
 * conversation.
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
}: {
  username: string;
  /** The journal's own title, so the room says whose it is. */
  title: string;
  /** The pane's contents, read on the server — `filesForRoom`. */
  files: RoomFiles;
  /** What the day card draws money with, the same options the wizard uses. */
  currency: CurrencyOptions;
  /** The newest unfinished day, if there is one — so the preview has
   *  something in it before anybody has said a word. */
  opening: { trip: string; slug: string } | null;
  /**
   * A conversation reopened by URL — B984, drawn from what was stored rather
   * than from the thread, which has a thirty-minute life and none of last
   * week's left.
   *
   * **Reopening is reading, not resuming.** These turns are drawn so somebody
   * can see what was said; the next thing they type starts from the twelve-turn
   * window the model would have had anyway. Saying so plainly here because
   * "carry on where you left off" is what a person will reasonably expect, and
   * only half of it is true.
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

  // Desktop only: a column a person has put away. The conversation never
  // moves, which is the point of putting either away.
  /**
   * The files column opens **only when there is something in it** — B947.
   *
   * A designer on a laptop: it holds 256px of muted placeholder on a journal
   * with an empty inbox, never changes shape, and takes that width from the
   * conversation, which is the pane that matters. Her own cut, asked which one
   * thing she would remove.
   *
   * Not hidden — the toggle is in the header either way, and one press brings
   * it back. What changes is which state a person with nothing to attach
   * starts in.
   */
  const [showFiles, setShowFiles] = useState(
    files.inbox.length > 0 || files.trip.length > 0,
  );
  const [showPreview, setShowPreview] = useState(true);

  // Phone only: the two things that slide over the conversation.
  const [sheet, setSheet] = useState(false);
  const [full, setFull] = useState(false);

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
      subject={subject}
      onUploaded={() =>
        setSubject((was) => (was ? { ...was, at: Date.now() } : was))
      }
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
      onOpen={() => setSheet(true)}
    />
  );

  return (
    // The room is the viewport, less the one thin frame `app/agent/layout.tsx`
    // puts over every page here (a back link, 3.5rem). Subtracting it is what
    // keeps the field at the bottom of the screen rather than below the fold
    // on a phone — the one thing a conversation must not do.
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-cream-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-navy-200 bg-cream-50 px-4 py-2">
        {/*
          The journal, and a way to change it only when there is one to change
          to — B984. A switcher on a person with one journal is a control that
          can only tell them what they already know.

          It writes a cookie and reloads: the choice has to survive a visit,
          and it must not go back into the path, which is the whole of what
          this ticket is about.
        */}
        {journals.length > 1 ? (
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
        ) : (
          <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-navy-900">
            {title}
          </h1>
        )}

        {/*
          Both mobile pills that used to live here are gone — B1016. They were
          chrome for things that are local: a preview is about the one day a
          turn just named, so it is a small card inside that turn now
          (`DayChip` in `HelperAsk`, opened with `onPreview` below); files are
          picked up beside the field that is about to mention them, so they
          are the strip above the composer instead (`filesStrip`, handed to
          `HelperAsk`). Neither needed a place in a row that also has to hold
          the journal's own name.
        */}

        {/* The same control, drawn the same way — B947. These were text links
            at `lg` and pill buttons below it: one function, two treatments,
            decided by how wide somebody's window happened to be. Kept here
            because a laptop still has room for a column to put away — B1016
            only removed the *phone's* pills, which had nowhere to put a
            column at all. */}
        <button
          type="button"
          onClick={() => setShowFiles((was) => !was)}
          className="hidden min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 lg:inline-flex lg:items-center"
        >
          {showFiles ? t("agent.room.hideFiles") : t("agent.room.showFiles")}
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((was) => !was)}
          className="hidden min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 lg:inline-flex lg:items-center"
        >
          {showPreview ? t("agent.room.hidePreview") : t("agent.room.showPreview")}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Left. Never drawn below `lg`: half a screen of thumbnails beside a
            conversation is the thing this layout is for not doing. */}
        {showFiles && (
          <section
            aria-label={t("agent.room.files")}
            className="hidden min-h-0 overflow-y-auto border-r border-navy-200 bg-cream-50 p-3 lg:block lg:w-64 lg:shrink-0"
          >
            {filesPane}
          </section>
        )}

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
            selected={selected}
            onSubject={(day) => setSubject({ ...day, at: Date.now() })}
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
             * full screen on a phone, where nothing else is up, or scrolling
             * the column that is already open on a wider one. `matchMedia`
             * is read defensively — a caller with none (a test) gets the
             * phone's own behaviour, which is the one this ticket is
             * actually about. Inline rather than a named function above:
             * `Date.now()` inside a plain function declaration reads to the
             * linter as something that might run during render; here it is
             * unambiguously an event handler, the same shape `onSubject`
             * below already uses.
             */
            onPreview={(day) => {
              setSubject({ ...day, at: Date.now() });
              const desktop =
                typeof window !== "undefined" &&
                typeof window.matchMedia === "function" &&
                window.matchMedia("(min-width: 1024px)").matches;
              if (desktop) {
                setShowPreview(true);
                setScrollTick((n) => n + 1);
              } else {
                setFull(true);
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
        {showPreview && (
          <section
            ref={previewRef}
            aria-label={t("agent.room.preview")}
            className="hidden min-h-0 overflow-y-auto border-l border-navy-200 bg-cream-50 p-3 lg:block lg:w-80 lg:shrink-0"
          >
            {previewPane}
          </section>
        )}
      </div>

      {sheet && (
        <Sheet label={t("agent.room.files")} close={t("agent.room.closeFiles")} onClose={() => setSheet(false)}>
          {filesPane}
        </Sheet>
      )}

      {full && (
        <Sheet
          label={t("agent.room.preview")}
          close={t("agent.room.closePreview")}
          onClose={() => setFull(false)}
          tall
        >
          {previewPane}
        </Sheet>
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
  tall = false,
  children,
}: {
  label: string;
  close: string;
  onClose: () => void;
  /** Full screen rather than up from the bottom — the preview is a day card
   *  and a card at 40% of a phone is not a preview of anything. */
  tall?: boolean;
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
      className={`m-0 w-full max-w-none border-0 bg-cream-50 p-0 backdrop:bg-navy-900/40 lg:hidden ${
        tall ? "fixed inset-0 h-full max-h-none" : "fixed inset-x-0 bottom-0 top-24 max-h-none rounded-t-2xl"
      } flex flex-col`}
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
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
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
function FilesPane({
  files,
  selected,
  onToggle,
  onClear,
  username,
  subject,
  onUploaded,
}: {
  files: RoomFiles;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  username: string;
  /** The day under discussion, or `null` when nothing has been named yet.
   *  `UploadPanel` reads only `trip` and `slug` off this — the `at` stamp is
   *  the preview's own business. */
  subject: { trip: string; slug: string } | null;
  /** A photograph landed. The room bumps the subject's stamp on this, which
   *  is what makes `PreviewPane` re-read the day — the same signal a mention
   *  in the conversation sends. */
  onUploaded: () => void;
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

      {files.inbox.length > 0 && (
        <Group heading={t("agent.room.inbox")}>
          {files.inbox.map((file) => (
            <Tile key={file.id} file={file} on={selected.includes(file.id)} onToggle={onToggle} />
          ))}
        </Group>
      )}

      {files.trip.length > 0 && (
        <Group heading={t("agent.room.onTrip", { trip: files.tripTitle })}>
          {files.trip.map((file) => (
            <Tile key={file.id} file={file} on={selected.includes(file.id)} onToggle={onToggle} />
          ))}
        </Group>
      )}

      <UploadPanel username={username} subject={subject} onUploaded={onUploaded} />
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

/**
 * The picker and the upload, moved into the room — B984, step 4 of
 * `docs/plans/…the-conversation-lives-at-three-urls.md`. Until this the only
 * page that could put a photograph on a day was the wizard's own; the room
 * had a preview of the day and files waiting for it, and no way to add one.
 *
 * The model is `startUploads`/`runQueue` in `AgentWizard.tsx`, unchanged in
 * substance: one storage check against the whole pick before anything is
 * sent, `enqueue` onto the on-disk queue so a killed tab resumes rather than
 * losing the pick, then `drain` — web copies first, so the day is readable
 * within seconds, with the originals climbing behind it. `onUploaded` is
 * called once the web phase completes and again when the drain finishes,
 * which is what makes `PreviewPane` show a growing day rather than a spinner.
 *
 * **The day is the subject, and there is no second way to choose one.** A
 * picker that let somebody attach a photograph while the conversation was
 * about nothing would be a picker deciding what the day is on its own — the
 * one thing this file's own rule (`AGENTS.md`, "the agent is the editor")
 * puts in the conversation's hands and nowhere else. So with no subject this
 * renders a sentence instead of a control, the same way `PreviewPane` renders
 * a sentence instead of a card.
 */
function UploadPanel({
  username,
  subject,
  onUploaded,
}: {
  username: string;
  subject: { trip: string; slug: string } | null;
  onUploaded: () => void;
}) {
  const { t } = useI18n();
  // The room mounts this pane twice at once — the desktop column stays in the
  // DOM behind `hidden lg:block` and the phone sheet is a second full copy —
  // so a fixed id here would put two `id="…"` inputs on one page. `useId()`
  // is React's own answer to exactly that: unique per mounted instance, and
  // stable for that instance's whole life.
  const pickerId = useId();
  const [chosen, setChosen] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<QueueProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(tripId: string, slug: string, list: File[]) {
    if (list.length === 0) return;
    setBusy(true);
    setError(null);
    // The one storage check, before any of it starts — B683, the same
    // courtesy `startUploads` in the wizard offers: a sentence somebody can
    // act on while every photograph is still in front of them, rather than
    // thirty-nine successful uploads and a wall on the fortieth.
    const room = await fetch(`/api/helper/${encodeURIComponent(username)}/day/media`).catch(
      () => null,
    );
    const body = (await room?.json().catch(() => null)) as
      | { remainingBytes: number | null }
      | null;
    if (!room || !room.ok || !body) {
      setError(t("agent.failed", { error: "network" }));
      setBusy(false);
      return;
    }
    const needed = list.reduce((n, file) => n + file.size, 0);
    const left = body.remainingBytes;
    if (left !== null && needed > left) {
      const mb = (n: number) => String(Math.max(1, Math.round(n / (1024 * 1024))));
      setError(t("agent.noRoom", { needed: mb(needed), left: mb(left) }));
      setBusy(false);
      return;
    }

    await enqueue(username, tripId, slug, list);
    setChosen([]);
    setBusy(false);

    let readable = false;
    await drain(username, (state) => {
      setProgress(state);
      if (!readable && state.webTotal > 0 && state.webDone === state.webTotal) {
        readable = true;
        onUploaded();
      }
    });
    onUploaded();
    setProgress((state) => (state && state.error ? state : null));
  }

  return (
    <section className="mt-4 border-t border-navy-200 pt-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
        {t("agent.uploadTitle")}
      </h2>

      {subject ? (
        <PhotoPicker
          id={pickerId}
          chosen={chosen}
          disabled={busy}
          onPick={(list) => {
            const files = Array.from(list ?? []);
            setChosen(files);
            if (files.length > 0) void upload(subject.trip, subject.slug, files);
          }}
        />
      ) : (
        <p className="mt-2 text-sm leading-6 text-navy-700">{t("agent.room.addPhotosNoDay")}</p>
      )}

      {/* Mounted from the first render, empty until there is something to
       *  say — B949 again, in the pane that taught this file the rule the
       *  first time. A live region created at the same moment as its first
       *  content is one a screen reader may never have been watching. */}
      <p role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-navy-800">
        {progress &&
          (progress.webDone < progress.webTotal
            ? t("agent.uploading", {
                done: String(progress.webDone),
                total: String(progress.webTotal),
              })
            : progress.originalDone < progress.originalTotal
              ? t("agent.uploadingOriginals", {
                  done: String(progress.originalDone),
                  total: String(progress.originalTotal),
                })
              : "")}
        {progress?.error && ` — ${t("agent.failed", { error: progress.error })}`}
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
