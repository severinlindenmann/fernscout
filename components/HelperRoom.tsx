"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import CurrencyProvider from "@/components/CurrencyProvider";
import HelperAsk from "@/components/HelperAsk";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { DayCard } from "@/components/StoryPager";
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
  consented: boolean;
  speech: boolean;
  consentedSpeech: boolean;
  speechProvider: string;
}) {
  const { t, tn } = useI18n();

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
  /** The last answer that came back, and which mention it answered. Kept as
   *  one value rather than as a card and a flag: "still reading" is then a
   *  comparison instead of a second piece of state to keep in step — and the
   *  card that is already up stays up while the next read is in flight, so a
   *  day being written does not blink out between two words. */
  const [landed, setLanded] = useState<{ at: number; preview: Preview | null } | null>(null);
  const preview = landed?.preview ?? null;
  const reading = subject !== null && landed?.at !== subject.at;

  // Desktop only: a column a person has put away. The conversation never
  // moves, which is the point of putting either away.
  const [showFiles, setShowFiles] = useState(true);
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
    />
  );

  const previewPane = (
    <PreviewPane preview={preview} reading={reading} currency={currency} />
  );

  return (
    // The room is the viewport, less the one thin frame `app/agent/layout.tsx`
    // puts over every page here (a back link, 3.5rem). Subtracting it is what
    // keeps the field at the bottom of the screen rather than below the fold
    // on a phone — the one thing a conversation must not do.
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col bg-cream-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-navy-200 bg-cream-50 px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate font-display text-base font-semibold text-navy-900">
          {title}
        </h1>

        {/* Reachable and dismissible by keyboard, both shapes — checklist D.
            On a phone these open the two dialogs; from `lg` up they put a
            column away and bring it back, and the conversation does not move
            either way. */}
        <button
          type="button"
          onClick={() => setSheet(true)}
          className="min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 lg:hidden"
        >
          {selected.length > 0
            ? tn("agent.room.selected", selected.length, { count: String(selected.length) })
            : t("agent.room.files")}
        </button>
        <button
          type="button"
          onClick={() => setFull(true)}
          disabled={!subject}
          className="min-h-11 rounded-full border border-navy-300 px-4 text-sm font-semibold text-navy-800 disabled:opacity-50 lg:hidden"
        >
          {t("agent.room.preview")}
        </button>

        <button
          type="button"
          onClick={() => setShowFiles((was) => !was)}
          className="hidden min-h-11 px-2 text-sm text-navy-700 underline underline-offset-4 hover:text-navy-900 lg:inline"
        >
          {showFiles ? t("agent.room.hideFiles") : t("agent.room.showFiles")}
        </button>
        <button
          type="button"
          onClick={() => setShowPreview((was) => !was)}
          className="hidden min-h-11 px-2 text-sm text-navy-700 underline underline-offset-4 hover:text-navy-900 lg:inline"
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
            selected={selected}
            onSubject={(day) => setSubject({ ...day, at: Date.now() })}
            onFilesMoved={(moved) => {
              // The pane's ids carry the `inbox:` prefix; the route answers
              // with the bare ids it moved.
              const gone = new Set(moved.map((id) => `inbox:${id}`));
              setInbox((was) => was.filter((file) => !gone.has(file.id)));
              setSelected((was) => was.filter((id) => !gone.has(id)));
            }}
          />
        </main>

        {/* Right. */}
        {showPreview && (
          <section
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
}: {
  files: RoomFiles;
  selected: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
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
    </div>
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
