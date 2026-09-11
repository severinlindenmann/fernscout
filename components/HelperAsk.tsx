"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import Image from "next/image";
import { Paperclip } from "lucide-react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import RecordButton from "@/components/RecordButton";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import RoomOpening from "@/components/RoomOpening";
import AnswerText from "@/components/AnswerText";
import type { Opening } from "@/lib/helper/opening";
import { decisionKind } from "@/lib/helper/blocks";
import type { Block, Option, Proposal, ProposalField } from "@/lib/helper/blocks";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The conversation — B899, round 2 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * It was a box that answered once. It is a conversation now: turns stacked in
 * order, a field that stays under them and keeps focus after sending, an
 * honest line while it thinks, and a way to start over. What each turn draws
 * is not this component's decision — a tool declares a shape (B898,
 * `lib/helper/blocks.ts`) and this renders the seven shapes and nothing else,
 * which is why adding a tool needs no change here.
 *
 * **What is deliberately not borrowed:** no avatar, no name, no personality,
 * no bubbles implying somebody is on the other side. This writes in a person's
 * journal. Their own sentence is a quiet line; the answer is plain text under
 * it, and the only thing that looks like a control is a thing you can press.
 *
 * **A proposal is accepted here — B900.** A write tool returns fields and a
 * sentence and writes nothing; this draws them **editable**, with one button
 * that says what it does. Pressing posts to the route the proposal names —
 * the same helper route the wizard's own buttons post to, which validates and
 * refuses exactly as it does for them. There is no second path to disk, and
 * this component knows the name of no tool: it posts where it is told.
 *
 * **The other half of accepting is saying what is wrong.** "no, the 14th"
 * goes into the field like any other sentence, and the turn it produces is a
 * fresh proposal in place of the old one. That is the difference between this
 * and a form, and it is why the fields being editable is the smaller half.
 *
 * **A refused or abandoned proposal costs nothing.** A conversation is free;
 * what a write costs is charged by the route it posts to, on the press. Three
 * corrections and then a press is one charge.
 *
 * **Reach is built in rather than filed after** — checklist D, and B795/B796
 * are the evidence that retrofitting it costs more. The thread is a `log` that
 * announces each new turn once (there is no streaming, so there is nothing to
 * announce per token); every block is operated with the keyboard or is not
 * operable at all; focus lands on a proposal when one arrives and on the field
 * otherwise; and the field is the last thing in the flow, so an on-screen
 * keyboard at 390px scrolls to it rather than sitting over it.
 *
 * **Quiet, and second** — B767. It opens as one sentence-case line under the
 * card's one bright button, and becomes a conversation when somebody taps it.
 */

/** One exchange as this browser has seen it: what was said, and what came
 *  back. The real conversation is the server's (`lib/helper/thread.ts`); this
 *  is only what to draw, which is why a reload starts the drawing again while
 *  the server's conversation carries on. */
type Exchange = {
  said: string;
  blocks: Block[];
  at?: number;
  /** Where the person's sentence arrived from — B1344 (E08). Only ever set
   *  for WhatsApp; a web turn is the normal case and carries no mark. */
  via?: "whatsapp";
};

/** One value out of a route's answer, by the path a proposal's `next`
 *  declared — `"draft.prose"`. Anything missing is left out rather than
 *  guessed at. */
function at(answer: unknown, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (found, key) =>
        found && typeof found === "object"
          ? (found as Record<string, unknown>)[key]
          : undefined,
      answer,
    );
}

/**
 * The thing as it now stands, from what the route answered.
 *
 * Every helper route that changes a day answers with the day, so a write can
 * be seen rather than merely reported. A route that answers with nothing to
 * draw contributes nothing here, and the sentence saying what happened is
 * still said.
 */
function previewOf(answer: Record<string, unknown>, t: (key: TranslationKey) => string): Block[] {
  const draft = answer.draft as Record<string, unknown> | undefined;
  const lines = [draft?.date, draft?.title].filter(
    (line): line is string => typeof line === "string" && line !== "",
  );
  const blocks: Block[] = lines.length > 0 ? [{ shape: "preview", text: "", lines }] : [];
  // `url` is the invite link, the postcards preview, or the photobook maker,
  // and it is answered exactly once — B931. A bare URL in a chat bubble is
  // not tappable on a phone (B1278), so this reaches the screen as a real
  // `<a>` — the same shape `kind: "link"` tools already draw — rather than as
  // one more line of plain text.
  const url = answer.url;
  if (typeof url === "string" && url !== "") {
    blocks.push({ shape: "link", text: "", href: url, label: t("agent.room.openOnSite") });
  }
  return blocks;
}

/** Whether a turn ends in something to check before it happens. Focus goes
 *  there when it does — a proposal nobody is looking at is a proposal nobody
 *  presses. */
function isProposal(block: Block): boolean {
  return block.shape === "form" || block.shape === "confirm";
}

/**
 * The failures a person can actually reach from here, in words — B919.
 *
 * `agent.failed` is `"That did not work: {error}"` and `{error}` was the API's
 * own identifier, so somebody who pressed a button was read
 * *"That did not work: incomplete_day"*. These five are what the conversation
 * can hit by ordinary use; anything else keeps the code, because a made-up
 * sentence about a failure nobody has seen would be worse than an identifier,
 * and is logged so it can be named later.
 */
/**
 * Every refusal a press can come back with, and the sentence it gets — B948.
 *
 * There were five, and `invalid_trip` was not among them: clearing the title
 * on a trip proposal and pressing put **"That did not work: invalid_trip."**
 * on the screen. A blind reader heard exactly that, at full volume, out of a
 * focused `role="alert"` — an internal identifier read aloud as though it were
 * a sentence.
 *
 * So this is now the whole list, taken from the routes rather than from
 * memory, and `test/helper-failure-sentences.test.ts` reads the routes back
 * and fails on a code that has arrived without one. The fallback below stays,
 * because a code is better than silence, and it should never be reached.
 */
const NAMED_FAILURES = [
  "incomplete_day",
  "day_exists",
  "slug_taken",
  "consent_required",
  "no_credits",
  "already_published",
  "no_day_on_date",
  "invalid_trip",
  "unknown_trip",
  "unknown_day",
  "nothing_to_change",
  "already_draft",
  "invalid_cost",
  "expected_files",
  "invalid_media",
  "not_attached",
  "unknown_inbox_file",
  "no_notes",
  "model_failed",
  "upstream_unavailable",
  "idempotency_conflict",
  "contacts_disabled",
  "helper_unavailable",
  "helper_disabled",
  "invalid_people",
  "too_many_requests",
  "invalid_json",
  "too_long",
  "invalid_request",
  "unknown_recipient",
  "unknown_photo",
  "no_recipients",
  "test_content",
  "postcards_disabled",
  "no_database",
] as const;

function failureSentence(
  t: (key: TranslationKey, vars?: Record<string, string>) => string,
  message: string,
): string {
  if ((NAMED_FAILURES as readonly string[]).includes(message)) {
    return t(`agent.error.${message}` as TranslationKey);
  }
  console.warn(`helper: a failure with no sentence of its own — "${message}"`);
  return t("agent.failed", { error: message });
}

/**
 * The day a turn is about, if it is about one — B901.
 *
 * The preview pane shows what the conversation is currently talking about,
 * and this is the whole of how it knows: a proposal's own arguments already
 * carry the trip and the slug, because a proposal is about a particular day.
 * Nothing is guessed and nothing is fetched here — a turn that names no day
 * leaves the pane exactly as it was, which is what "follows the conversation"
 * has to mean when the conversation wanders.
 */
function dayOf(blocks: Block[]): { trip: string; slug: string } | null {
  for (const block of [...blocks].reverse()) {
    if (block.shape !== "form" && block.shape !== "confirm") continue;
    const args = block.proposal?.arguments;
    if (args?.trip && args?.slug) return { trip: args.trip, slug: args.slug };
  }
  return null;
}

/** The date a turn's own proposal carries, for the inline card below — B1016.
 *  Every write tool that already has a day resolves and fills a `date`
 *  argument (`start_day`'s own questions, B917, and every tool after it), so
 *  this reads the same `arguments` `dayOf` already reads rather than asking
 *  for anything new. Absent is honest too: the card falls back to a plain
 *  label rather than a blank date. */
function dateOf(blocks: Block[]): string | null {
  for (const block of [...blocks].reverse()) {
    if (block.shape !== "form" && block.shape !== "confirm") continue;
    const date = block.proposal?.arguments.date;
    if (typeof date === "string" && date !== "") return date;
  }
  return null;
}

/**
 * A next-step chip over the composer — B1212 (D18), extended by B1218.
 *
 * A plain string sends itself through the ordinary `ask()`, exactly as
 * before this ticket. `{ tool, args }` opens that tool's own proposal card
 * through `onProposal` instead — "Rückgängig", the weather lookup and the
 * cost form, none of which are a sentence for the model to interpret.
 * `{ share }` is D51's one non-server chip: it hands a URL to the platform's
 * own share sheet and touches no route at all.
 */
type Suggestion =
  | string
  | { label: string; tool: string; args: Record<string, string> }
  | { label: string; share: string };

const DECISION_ICON: Record<ReturnType<typeof decisionKind>, string> = {
  grant: "🔑",
  spend: "💳",
  destroy: "🗑️",
  edit: "✏️",
};

/**
 * The wait between a sentence and an answer, drawn — B1124.
 *
 * Two states and no more. `"assembling"` is used the one place this
 * component can actually name what is coming: `accept()`'s own chained
 * `next` proposal, where the tool that is about to answer is already known
 * because the first proposal named it. Everywhere else — every ordinary
 * `ask()` — the shape of the answer is not known until it arrives, so the
 * fallback is the three waymark lozenges: the mark itself, not a borrowed
 * spinner. `prefers-reduced-motion` removes the animation entirely in
 * `app/globals.css`, which for `fs-assemble-in` leaves every piece fully
 * shown (nothing here sets an inline "hidden" state) and for
 * `fs-waymark-bounce` leaves three still dots — none of it shorter, all of
 * it gone.
 */
function TurnLoader({
  shape,
  status,
}: {
  shape: "assembling" | "waymark";
  /**
   * The server's own honest line about what it is doing right now — B1213
   * (D19): "reading the day…" rather than three dots with nothing behind
   * them. Absent on the first render of a turn (nothing has started yet)
   * and on a server too old to send one, in which case the dots alone carry
   * the wait exactly as they always have.
   */
  status?: string;
}) {
  if (shape === "assembling") {
    return (
      <div
        aria-hidden
        className="mb-2 space-y-2 rounded-xl border border-navy-200 bg-white p-4"
      >
        <div className="fs-assemble-in h-3 w-24 rounded bg-navy-200" style={{ animationDelay: "0ms" }} />
        <div
          className="fs-assemble-in h-11 w-full rounded-xl bg-navy-100"
          style={{ animationDelay: "90ms" }}
        />
        <div
          className="fs-assemble-in h-11 w-full rounded-xl bg-navy-100"
          style={{ animationDelay: "180ms" }}
        />
        <div
          className="fs-assemble-in h-11 w-28 rounded-full bg-navy-200"
          style={{ animationDelay: "270ms" }}
        />
      </div>
    );
  }
  return (
    <div aria-hidden className="mb-2 flex items-center gap-2 px-1">
      {status && <span className="text-sm text-navy-600">{status}</span>}
      <span className="flex gap-2">
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="fs-waymark-bounce h-3 w-3 rounded-full bg-yellow-400"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
    </div>
  );
}

export default function HelperAsk({
  username,
  consented: initialConsent,
  speech,
  consentedSpeech,
  speechProvider,
  selected,
  onSubject,
  onFilesMoved,
  dayPhoto,
  onPreview,
  filesStrip,
  notice,
  onOpenFiles,
  aboutOffer = false,
  aboutDraft = null,
  injected = null,
  onFieldFocusChange,
  inRoom = false,
  opened = [],
  opening,
  whatsappNumber,
  weather = false,
  onProposal,
  onCreditsSettled,
}: {
  username: string;
  /** Whether this journal has already agreed to a model being spoken to
   *  (`lib/helper/consent.ts`). Read on the server, so the panel is not shown
   *  to somebody who has already read it. */
  consented: boolean;
  /** Whether the `transcription` capability is on for this journal — B686.
   *  Off, the field takes typed sentences exactly as it did. */
  speech: boolean;
  /** Whether this journal has agreed to its owner's voice being sent. */
  consentedSpeech: boolean;
  /** Who a recording actually goes to — B744. Passed through to
   *  `RecordButton`, which reads it rather than assuming Deepgram. */
  speechProvider: string;
  /**
   * What is selected in the files pane beside this — B902. Sent with every
   * sentence, so "put these on yesterday" has something to refer to; the
   * server resolves the ids against disk and ignores what it does not
   * recognise. Absent everywhere there is no pane, which is everywhere but
   * the room.
   */
  selected?: string[];
  /**
   * The day the conversation has arrived at — B901. Called when a turn or an
   * accepted proposal names one, and never otherwise; the room draws it in
   * the preview pane. A conversation with nobody listening behaves exactly as
   * it did.
   */
  onSubject?: (day: { trip: string; slug: string }) => void;
  /**
   * Inbox ids that an accepted write moved onto a day — B915. The room drops
   * them from the files pane and from the selection; nowhere else listens,
   * and a conversation with nobody listening behaves exactly as it did.
   */
  onFilesMoved?: (ids: string[]) => void;
  /**
   * The photograph the room already has loaded for one particular day —
   * B1016. `HelperRoom` reads it once, for whichever day `subject` names, off
   * the same `DayCard` data `PreviewPane` draws from; passing the trip and
   * slug alongside is what lets a turn's own inline card tell whether the
   * photograph on offer is actually a photograph *of the day it names* rather
   * than of whatever the room happened to be looking at last. Absent, or a
   * turn about a different day, draws a plain marker instead of fetching a
   * second copy of a day this component has no business reading on its own.
   */
  dayPhoto?: { trip: string; slug: string; src: string | null } | null;
  /**
   * A turn's inline card was pressed — B1016. The room decides what "look at
   * it" means: full screen on a phone, where there is nowhere else to put a
   * day card, or scrolling the existing preview column into view on a wider
   * screen, which already has one open. Absent under a journal's day card,
   * where there is no preview to show at all.
   */
  onPreview?: (day: { trip: string; slug: string }) => void;
  /**
   * The files strip, drawn by the room above the composer rather than beside
   * the conversation — B1016. Handed over as a node rather than built here,
   * because the composer's own sticky footer is the one place "above the
   * field" can mean, and only this component draws that footer.
   */
  filesStrip?: React.ReactNode;
  /** One quiet line above the composer, when the room has something the
   *  person should hear before the next sentence — the low-credit warning
   *  is the first tenant. B1208 (D08). */
  notice?: React.ReactNode;
  /**
   * Open the files pane — B1182. On a phone the pane used to be reachable
   * only through the thumbnail strip, which renders only once a file
   * exists: a new journal had no way to upload anything at all. This is
   * the always-present way in; absent everywhere there is no pane.
   */
  onOpenFiles?: () => void;
  /**
   * The room was opened from a particular day (`?about=`) — B994. The
   * conversation already carries a note naming it, so this draws a local
   * offer of the things somebody standing on a day likely wants; pressing
   * one sends it as the first sentence. Free, like every choose block:
   * no model call until a press.
   */
  aboutOffer?: boolean;
  /** Whether the day the offer is about is a draft — B1199. `null` until
   *  the preview's read lands; the state-dependent option waits for it. */
  aboutDraft?: boolean | null;
  /** A turn handed in from outside the conversation — B1214 (D26): the
   *  preview header's publish shortcut fetches the ordinary publish
   *  proposal and this is how its card enters the thread. */
  injected?: { blocks: Block[]; at: number } | null;
  /**
   * The field gained or lost focus — B1016. The strip above the composer
   * collapses while somebody is about to type, because the arithmetic in
   * B1016 is what is left of the screen once the keyboard is up: not enough
   * for both. Absent everywhere there is no strip to collapse.
   */
  onFieldFocusChange?: (focused: boolean) => void;
  /**
   * Whether this is the room's middle column rather than a line under a card
   * — B901. In the room the conversation is the page: it is open from the
   * start (there is nothing else on the screen to compete with) and it grows
   * to fill its column instead of stopping at 60% of the viewport.
   */
  inRoom?: boolean;
  /** A conversation reopened by URL, oldest first — B984. Drawn, not resumed;
   *  see the state below. */
  opened?: { created_at?: string; said: string | null; answered: string | null; origin?: string | null }[];
  /** What the room says before anybody has said anything — B984. Absent under
   *  a journal's day card, where the conversation is not the whole page. */
  opening?: Opening;
  /** The wa.me chip's number, resolved server-side — B1127. Threaded through
   *  to `RoomOpening` unchanged; see `HelperRoom.tsx`'s own doc on it. */
  whatsappNumber?: string;
  /** Whether the `weather` capability is on for this journal — B1218 (D48).
   *  Off, and the follow-up chip after a words write never offers a lookup
   *  this server could not service. */
  weather?: boolean;
  /**
   * Open one tool's proposal in the thread without a sentence — B1218,
   * reusing `HelperRoom.tsx`'s `proposeToThread`: the "Rückgängig", weather
   * and cost chips after a words write call this rather than `go()`, because
   * what they offer is a specific tool and specific arguments, not a
   * sentence for the model to interpret.
   */
  onProposal?: (tool: string, args: Record<string, string>) => void;
  /**
   * Told after every turn and every accepted proposal has settled, spent or
   * not — B1255. `ask` charges a flat credit a turn since B1091 and a write
   * proposal's own route may charge more; this is called unconditionally
   * rather than only on the writes this file happens to know cost something,
   * because a second list of "which tools charge" here would duplicate the
   * server's own pricing and drift from it. The host re-reads the balance;
   * this component never reads or shows one itself.
   */
  onCreditsSettled?: () => void;
}) {
  const { t, formatLongDate } = useI18n();
  // Closed until somebody asks for it — B767. The one thing this card is for
  // is writing a day, and a text field competing with that button is a second
  // decision offered to somebody who has not made the first one.
  const [open, setOpen] = useState(inRoom);
  const [said, setSaid] = useState("");
  /**
   * A coarse pointer means a phone's keyboard — B1211 (D13): there, the
   * return key breaks the line and the send button sends; on a fine
   * pointer Enter sends and Shift+Enter breaks. Read once after mount so
   * the server and the first client render agree.
   */
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    // Subscribed, not read once — B1338: a room mounted under DevTools'
    // device emulation (or a tablet docked to a keyboard) otherwise keeps
    // the wrong Enter behaviour until a full reload.
    const query = window.matchMedia("(pointer: coarse)");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  /** The sentence a failed turn was carrying, so its error row can offer
   *  one-press retry — B1212 (D20). */
  const [lastFailed, setLastFailed] = useState("");
  /**
   * What to offer after a write went through — B1212 (D18): a small,
   * deterministic set of next sentences per kind of write, drawn as chips
   * over the composer. No model involved; pressing one sends it through
   * the ordinary ask. Cleared by the next sentence either way.
   */
  /**
   * A plain string sends itself through the ordinary `ask()`, exactly as
   * before B1218; `{ label, tool, args }` instead opens that tool's own
   * proposal card through `onProposal` — the "Rückgängig", weather and cost
   * chips, none of which are a sentence for the model to interpret.
   */
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  /** Markers between exchanges need a clock comparison that the server
   *  cannot make identically — drawn only after mount. B1212 (D22). */
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);
  const [busy, setBusy] = useState(false);
  /** Which of the two waits `TurnLoader` draws — B1124. `"waymark"` unless a
   *  call below knows better before it starts. */
  const [waitShape, setWaitShape] = useState<"assembling" | "waymark">("waymark");
  /**
   * The server's own line about what it is doing right now — B1213 (D19).
   * Set from a streamed status line, cleared at the start of every turn and
   * once it lands; a server that answers plain JSON instead never sets it
   * and the dots read exactly as they did before this existed.
   */
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  // B807 — told apart from every other failure, because it is the only one
  // with something the person can do about it. A man mid-write-up got
  // `not_your_journal` with nothing on the screen, read it as the software
  // being broken, and closed the tab.
  const [lapsed, setLapsed] = useState(false);
  /**
   * A conversation reopened by URL starts with what was stored — B984.
   *
   * Read once, into the initial state, rather than pushed in by an effect: the
   * turns are already on the server's render and an effect would draw the room
   * empty and then fill it, which is a flash on every reopen.
   *
   * **Reopening is reading.** These turns are here to be seen; the next thing
   * anybody types starts from the twelve-turn window the model would have had
   * anyway, because the thread they came from expired half an hour after it
   * was last spoken to.
   */
  const [turns, setTurns] = useState<Exchange[]>(() =>
    opened.map((turn) => ({
      said: turn.said ?? "",
      blocks: turn.answered ? [{ shape: "say" as const, text: turn.answered }] : [],
      at: turn.created_at ? Date.parse(turn.created_at) : undefined,
      via: turn.origin === "whatsapp" ? ("whatsapp" as const) : undefined,
    })),
  );
  /** The last thing the microphone heard — B893. Kept only so it can be said
   *  aloud once and shown as correctable; the words themselves live in the
   *  field, where they can be edited. */
  const [heard, setHeard] = useState("");
  const [consented, setConsented] = useState(initialConsent);
  const [consenting, setConsenting] = useState(false);

  // The field replaces the line that opened it, so without this focus falls to
  // `<body>` and the person is left exploring the page to find out whether
  // anything happened — B795. It carries its own label, so it is both the
  // announcement and the destination.
  const box = useRef<HTMLTextAreaElement>(null);
  /**
   * Unsent words survive a reload — B1211 (D16). Restored once after
   * mount (never in the initializer, B1197's lesson) and written on every
   * change; sending clears the field, and the write effect empties the
   * store with it.
   */
  const draftKey = `fs.agent.draft.${username}`;
  useEffect(() => {
    const kept = window.localStorage.getItem(draftKey);
    if (kept && inRoom) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaid((was) => (was === "" ? kept : was));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!inRoom) return;
    window.localStorage.setItem(draftKey, said);
  }, [said, draftKey, inRoom]);
  /** The textarea grows with its words, to six lines — B1211 (D13). */
  function autosize() {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 152)}px`;
  }
  useEffect(autosize, [said]);
  const proposal = useRef<HTMLDivElement>(null);
  /**
   * What gets scrolled into view when a turn ends in a proposal — B1258.
   *
   * It used to be `proposal` itself: scrolling the confirm card's own top to
   * the viewport's top pushes everything the turn rendered *before* the card
   * off-screen above it, which on a day-publish turn is the preview block
   * `run.ts` pushes ahead of the confirm card — the very thing "read it as
   * your readers will see it" is asking the person to look at. This ref sits
   * on the whole turn instead, so its top (the preview, if there is one) is
   * what lands below the sticky header, with the card readable underneath.
   */
  const turnTop = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  /**
   * The strip's own collapse reads the field's `focus` event — B1016 — and
   * these two effects put focus there with nothing a phone would call a tap:
   * one runs on mount, the other after a fetch resolves, both well outside
   * any click a browser would treat as permission to raise the keyboard. So
   * neither should tell the strip a keyboard is coming; this flag is what
   * the `onFocus` handler below checks before it says so. A real tap on the
   * field — or the `choose` chips, which call the same `.focus()` from
   * inside their own click handler — leaves the flag unset and collapses the
   * strip exactly as it should.
   */
  const silentFocus = useRef(false);
  useEffect(() => {
    if (open) {
      silentFocus.current = true;
      box.current?.focus();
    }
  }, [open]);

  // Where the screen goes when a turn arrives — one decision, not two
  // effects quietly disagreeing about it (B1253: a bottom-scroll effect ran
  // after this one on every render and undid it). A turn ending in a
  // proposal gets its top scrolled into view, because a proposal nobody is
  // looking at is a proposal nobody presses, and its buttons matter more
  // than whatever came before it; anything else scrolls the thread to the
  // newest line instead, the one a conversation on a phone must not move
  // the field away from.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (last && last.blocks.some(isProposal)) {
      proposal.current?.focus();
      // `start`, not `nearest` (B1253): the card can be taller than the
      // viewport, and the sentence explaining it sits above the buttons —
      // `scroll-mt-24` on the turn's own top matches the sticky page header
      // so that top lands below it rather than under it. Scrolling the whole
      // turn rather than only the card (B1258) is what keeps a preview block
      // rendered ahead of the card on screen instead of scrolled past.
      turnTop.current?.scrollIntoView?.({ block: "start" });
    } else {
      silentFocus.current = true;
      box.current?.focus();
      if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }
  }, [turns]);

  /** An injected turn joins the thread once per stamp — B1214 (D26). */
  const injectedAt = useRef(0);
  useEffect(() => {
    if (!injected || injected.at === injectedAt.current) return;
    injectedAt.current = injected.at;
    setTurns((was) => [...was, { said: "", blocks: injected.blocks, at: injected.at }]);
  }, [injected]);

  /** The one failure with a way out of it, told apart from the rest — B807. */
  function failed(thrown: unknown) {
    const message = (thrown as Error).message;
    if (message === "session_lapsed") setLapsed(true);
    else setError(failureSentence(t, message));
  }

  /** Draw one more exchange and empty the field, because the next sentence is
   *  a next sentence and not a correction of the last one. */
  function landed(blocks: Block[], words = said) {
    setTurns((was) => [...was, { said: words, blocks, at: Date.now() }]);
    setSaid("");
    setHeard("");
    setSuggestions([]);
    const day = dayOf(blocks);
    if (day) onSubject?.(day);
  }

  async function send(
    url: string,
    body?: unknown,
    method = "POST",
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      // **Every method here carries the body, and PATCH is why this is a
      // comment.** It used to read `method === "POST" ? … : undefined`, so a
      // PATCH press sent a content-type saying JSON and no JSON at all; the
      // route's `request.json()` threw and answered `invalid_json`, and the
      // person was told "something in that press did not arrive properly"
      // about a card that was perfectly correct.
      //
      // It was live from B898 — `set_day_words`, which is *writing the words
      // of a day*, the most-used write in this product — and was found only
      // when B1078's four trip tools joined it and somebody pressed one on
      // the real site. Nothing caught it because every test presses a route
      // handler directly with a body already in hand; none of them go through
      // this function. `test/helper-press-body.test.ts` is the one that does.
      //
      // There is no method here that should send an empty body: a proposal's
      // arguments *are* the press (B900).
      body: JSON.stringify(body ?? {}),
    });
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      /**
       * A gateway answering for a server that is restarting sends HTML, not
       * the route's own JSON — B1186. The person then read "That did not
       * work: 502", the bare code, in English, mid-conversation on the live
       * site. A 5xx with no named error is exactly that case, and its
       * honest sentence is "nothing was lost, try once more".
       */
      if (json.error == null && response.status >= 500) {
        throw new Error("upstream_unavailable");
      }
      throw new Error(String(json.error ?? response.status));
    }
    return json;
  }

  /**
   * The `ask` endpoint, over NDJSON where the server offers it — B1213
   * (D19). A status line is `{status: "…"}`; the answer is the one
   * `{done: …}` line at the end, and it is the **same body** `send()` would
   * have returned whole — a status event never stands in for it.
   *
   * `Accept` is what asks for the stream; whether it arrives is read from
   * the response's own `content-type`, never assumed from having asked.
   * Content negotiation both ways: a server too old to stream answers plain
   * JSON regardless of the header, and this falls back to reading it exactly
   * as `send()` does; a client too old to read the stream (there is none yet,
   * but the shape is what makes that safe later) would see a
   * `content-type` it does not recognise and could fall back the same way.
   */
  async function askStreamed(
    url: string,
    body: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/x-ndjson" },
      body: JSON.stringify(body ?? {}),
    });
    const streaming = (response.headers?.get("content-type") ?? "").includes(
      "application/x-ndjson",
    );
    if (!streaming) {
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        if (json.error == null && response.status >= 500) {
          throw new Error("upstream_unavailable");
        }
        throw new Error(String(json.error ?? response.status));
      }
      return json;
    }
    if (!response.body) throw new Error("upstream_unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: Record<string, unknown> | null = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const at = buffer.indexOf("\n");
        if (at < 0) break;
        const raw = buffer.slice(0, at).trim();
        buffer = buffer.slice(at + 1);
        if (raw === "") continue;
        const parsed = JSON.parse(raw) as { status?: unknown; done?: Record<string, unknown> };
        if (typeof parsed.status === "string") setStatus(parsed.status);
        if (parsed.done) done = parsed.done;
      }
      if (finished) break;
    }
    if (!done) throw new Error("upstream_unavailable");
    if (typeof done.error === "string") throw new Error(done.error);
    return done;
  }

  async function ask(override?: string) {
    // B984 — a chip in the opening sends its sentence through here rather than
    // through anything of its own. State would not have settled by the time
    // this ran, which is why the words are an argument and not a `setSaid`.
    const words = override ?? said;
    setBusy(true);
    // The shape of an ordinary ask is never known ahead of the answer —
    // B1124's fallback, always, here.
    setWaitShape("waymark");
    setStatus("");
    setError("");
    setLapsed(false);
    try {
      const body = await askStreamed(
        `/api/helper/${encodeURIComponent(username)}/ask`,
        {
          said: words,
          // B902 — what is selected in the files pane, sent every turn rather
          // than remembered, so a cleared selection is cleared at once.
          ...(selected && selected.length > 0 ? { selected } : {}),
          // Their today, not the server's: "in March" is answered from where
          // the person is standing.
          today: new Date().toISOString().slice(0, 10),
        },
      );
      const blocks = (body.blocks as Block[] | undefined) ?? [];
      landed(
        blocks.length > 0 ? blocks : [{ shape: "say", text: t("agent.askUnknown") }],
        words,
      );
    } catch (thrown) {
      // Kept so the error row can offer one press to resend — B1212 (D20).
      setLastFailed(words);
      failed(thrown);
    } finally {
      setBusy(false);
      setStatus("");
      // Settled, whichever way — B1255. `ask` spends a flat credit before
      // its one model call (B1091) and a 402 is as real a spend-adjacent
      // event as a 200, so this runs on both.
      onCreditsSettled?.();
    }
  }

  async function consentThenAsk() {
    setBusy(true);
    setError("");
    try {
      await send(`/api/helper/${encodeURIComponent(username)}/consent`);
      setConsented(true);
      setConsenting(false);
      setBusy(false);
      await ask();
    } catch (thrown) {
      failed(thrown);
      setBusy(false);
    }
  }

  /**
   * Accept one proposal — B900, and the only thing on this screen that changes
   * anything.
   *
   * It posts what the proposal says to post, where the proposal says to post
   * it: an existing helper route, which validates and refuses exactly as it
   * does for the wizard's own buttons. This component knows the name of no
   * tool, which is what keeps "adding a tool needs no client change" true.
   *
   * What follows a press is three small things and no navigation — a
   * conversation that jumped to another page would lose itself:
   *
   * 1. the thread is told, so the next turn knows it happened rather than
   *    offering to do it again;
   * 2. a chained proposal, where the tool declared one, opens with what came
   *    back — the words a model made out of their notes are read *here*,
   *    before a second press keeps them;
   * 3. otherwise the day as it now stands, and the sentence saying what
   *    happened, in their own language.
   */
  async function accept(proposal: Proposal, values: Record<string, string>) {
    setBusy(true);
    setWaitShape("waymark");
    setError("");
    try {
      /**
       * What is posted: **the proposal's own arguments**, then whatever the
       * person typed over.
       *
       * The fields used to be merged in here as well — B915, because a
       * `confirm` draws none and a press without them was about a different
       * day from the one that was read. They are folded into `arguments` at
       * the source now (B935, B936), so this merge would only be a second
       * copy of the same rule, in the one place that must not be the thing
       * making a proposal correct: anything else reading `arguments` — an
       * agent, a test, the next surface somebody builds — gets exactly what
       * this button sends.
       */
      const sent = { ...proposal.arguments, ...values };
      const answer = await send(proposal.endpoint, sent, proposal.method);

      /**
       * The preview pane follows the press — B901. A write is the moment the
       * thing being talked about actually changes, and the pane's whole
       * promise is that you watch what you are about to accept and then see
       * what you accepted. The day it names is the route's own answer, not
       * this component's guess about what it wrote.
       */
      const wrote = answer.draft as Record<string, unknown> | undefined;
      const trip =
        typeof wrote?.trip === "string" ? wrote.trip : proposal.arguments.trip;
      const slug =
        typeof wrote?.slug === "string" ? wrote.slug : proposal.arguments.slug;
      if (trip && slug) onSubject?.({ trip, slug });

      /**
       * Files the write says have left the inbox — B915. The pane offered
       * them; they are on a day now, so it must stop. This component still
       * knows the name of no tool: it reads a field of the answer, exactly as
       * it reads `draft` above.
       */
      const moved = Array.isArray(answer.moved)
        ? answer.moved.filter((one): one is string => typeof one === "string")
        : [];
      if (moved.length > 0) onFilesMoved?.(moved);

      /**
       * Nothing is posted to say the write happened — B939.
       *
       * There used to be a second call here, and it was the only thing telling
       * the conversation that a press had gone through. A tester pressing the
       * same routes with `curl` was told on the next turn that their trip was
       * waiting to be saved, while it sat on disk. The route that writes says
       * so itself now, so every caller gets it and this one has nothing to
       * remember.
       */

      if (proposal.next) {
        const carried: Record<string, string> = { ...sent };
        for (const [name, path] of Object.entries(proposal.next.from)) {
          const found = at(answer, path);
          if (typeof found === "string" && found !== "") carried[name] = found;
        }
        // B1124's one "known" case: this proposal already names the tool
        // that is about to answer, so the wait draws a card assembling
        // rather than the shapeless fallback.
        setWaitShape("assembling");
        const next = await send(
          `/api/helper/${encodeURIComponent(username)}/proposal`,
          {
            tool: proposal.next.tool,
            arguments: carried,
            today: new Date().toISOString().slice(0, 10),
          },
        );
        // `proposal.done` used to open this turn as well as ProposalView's
        // own card, so every chained accept read the same outcome twice —
        // B1256. The next proposal's own sentence is what belongs here; say
        // nothing before it. And when there is neither that nor a next
        // proposal, push no turn at all rather than one with nothing in it.
        const chainedBlocks = (next.blocks ?? []) as Block[];
        if (chainedBlocks.length > 0) {
          setTurns((was) => [...was, { said: "", blocks: chainedBlocks }]);
        } else {
          // Nothing new arrived to put focus on — back to the field, same as
          // an ordinary accept with nothing to preview.
          silentFocus.current = true;
          box.current?.focus();
        }
        return;
      }

      // Same duplicate, same fix — B1256: `proposal.done` is the card's own
      // closing line (ProposalView renders it already) and does not belong
      // in the turn a second time. No turn at all when there is nothing
      // else to show — and the field gets focus directly rather than
      // through the turns effect, since there is no turn here to trigger it.
      const previewBlocks = previewOf(answer, t);
      if (previewBlocks.length > 0) {
        setTurns((was) => [
          ...was,
          { said: "", blocks: previewBlocks, at: Date.now() },
        ]);
      } else {
        silentFocus.current = true;
        box.current?.focus();
      }

      /**
       * The next-step chips — B1212 (D18). Keyed on what was just written,
       * from the tool's own name (the same self-classification
       * `decisionKind` uses): words saved offer publishing and photographs;
       * a day published offers the next one. Deterministic, free, and one
       * press sends the sentence through the ordinary ask.
       */
      const wroteWords = /draft_words|set_day_words|write_day/.test(proposal.tool);
      const published = /^publish_day$/.test(proposal.tool);
      if (wroteWords) {
        const chips: Suggestion[] = [t("agent.about.publish"), t("agent.about.addPhoto")];
        /**
         * Undo, weather and cost — B1218 (D47/D48/D49) — only after the
         * write that actually reached disk. `draft_words` is prose to read
         * back, not yet kept: there is nothing on disk for undo to restore
         * or for a coordinate to hang off yet.
         */
        if (proposal.tool === "set_day_words" && trip && slug) {
          chips.push({ label: t("agent.follow.undo"), tool: "undo_words", args: { trip, slug } });
          if (weather && wrote?.hasCoordinates) {
            chips.push({
              label: t("agent.follow.weather"),
              tool: "look_up_weather",
              args: { trip, slug },
            });
          }
          chips.push({ label: t("agent.follow.addCost"), tool: "add_cost", args: { trip, slug } });
        }
        setSuggestions(chips);
      } else if (published) {
        const chips: Suggestion[] = [t("agent.open.sayNewDay")];
        // The system share sheet, beside the next-day suggestion — B1218
        // (D51). Only where the platform actually has one, and only ever
        // with the URL the publish route itself just answered.
        const url = typeof answer.url === "string" ? answer.url : "";
        if (url && typeof navigator !== "undefined" && typeof navigator.share === "function") {
          chips.push({ label: t("agent.follow.share"), share: url });
        }
        setSuggestions(chips);
      }
    } catch (thrown) {
      /**
       * The card that was pressed says so, and this does not — B916.
       *
       * A refusal appended under the log is disconnected from the fields that
       * caused it, and it used to arrive *after* the card had already claimed
       * the day was started. So the failure is thrown back to `ProposalView`,
       * which keeps the fields, re-enables the button and puts the sentence
       * beside them. The one exception is a lapsed session, which has a way
       * out of its own and belongs to the whole conversation rather than to
       * this proposal.
       */
      if ((thrown as Error).message === "session_lapsed") setLapsed(true);
      throw thrown;
    } finally {
      setBusy(false);
      // Settled, whichever way — B1255. A write proposal may charge on its
      // own route, and a refusal (including `no_credits`) is a settled
      // attempt too.
      onCreditsSettled?.();
    }
  }

  /**
   * The one door onto `ask()` — B1020.
   *
   * A chip in the opening used to call `ask()` on its own, past this
   * function entirely, which is how a first-time owner pressing the
   * brightest thing on the screen reached `consent_required` with no consent
   * panel anywhere on it — the chip had skipped the very check that opens
   * one. A chip is "a shortcut for typing" (`RoomOpening.tsx`'s own words),
   * so it goes through here now, the same door the field's own Ask button
   * always has: consented sends the words on; not consented puts them where
   * `consentThenAsk` will find them and opens the panel instead of writing
   * anything.
   */
  function go(override?: string) {
    const words = override ?? said;
    if (words.trim() === "" || busy) return;
    if (consented) void ask(words);
    else {
      setSaid(words);
      setConsenting(true);
    }
  }

  if (!open && !inRoom) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 min-h-11 text-base text-navy-700 underline underline-offset-4 transition-colors hover:text-navy-900"
      >
        {t("agent.askOpen")}
      </button>
    );
  }

  return (
    <section
      aria-label={t("agent.chat.title")}
      className={inRoom ? "flex min-h-0 flex-1 flex-col" : "mt-4"}
    >
      {/*
        The thread. `log` with `aria-live="polite"` announces each turn once as
        it is added — there is no streaming here, so there is nothing to
        announce per token. It scrolls itself rather than the page, which is
        what keeps the field still on a phone.
      */}
      {/* In the room the log is in the document from the first render, empty
          — a live region added at the same moment as its first child is a
          live region a screen reader may never announce. Under a card it
          appears with the first turn, as it has since B899. */}
      {(inRoom || turns.length > 0) && (
        <div
          ref={log}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className={`mb-3 space-y-6 overflow-y-auto overscroll-contain ${inRoom ? "min-h-0 flex-1" : "max-h-[60vh]"}`}
        >
          {/*
            What is kept, said once before anything is said to it — B976.
            
            Only in the room and only while the conversation is empty: it is
            the first thing on an empty screen and then it is gone, which is
            where a notice belongs. Repeating it above every turn would make
            it furniture nobody reads, and saying it after somebody has
            already talked would be late.

            The wording is exact about the one thing a person would otherwise
            assume wrong. Their conversations are saved so they can return to
            them — that is the feature — and nobody else reads them unless
            they say so, which is the part they control on their own page.
          */}
          {inRoom && turns.length === 0 && (
            <>
              {aboutOffer ? (
                /* Opened from a day — B994. The offer replaces the general
                   opening: somebody who pressed a link on a day is not here
                   about whatever else is unfinished. */
                <div className="space-y-2">
                  <p className="rounded-2xl border border-navy-200 bg-white px-4 py-3 text-base leading-6 text-navy-800">
                    {t("agent.about.offer")}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {/* The last option follows the day's real state — B1199:
                        offering to take a draft off the site is a small lie
                        about it. Absent until the preview's read answers. */}
                    {([
                      "rewrite" as const,
                      "addPhoto" as const,
                      "addCost" as const,
                      ...(aboutDraft === true
                        ? ["publish" as const]
                        : aboutDraft === false
                          ? ["unpublish" as const]
                          : []),
                    ]).map((what, n) => (
                      <button
                        key={what}
                        type="button"
                        onClick={() => go(t(`agent.about.${what}`))}
                        className={`min-h-11 rounded-full px-4 text-sm transition-colors ${
                          n === 0
                            ? "border border-yellow-600 bg-yellow-400 font-semibold text-yellow-950 hover:bg-yellow-300"
                            : "border border-navy-300 bg-white text-navy-800 hover:bg-navy-50"
                        }`}
                      >
                        {t(`agent.about.${what}`)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                opening && <RoomOpening opening={opening} onSay={go} whatsappNumber={whatsappNumber} />
              )}
              <p className="mt-3 text-sm leading-6 text-navy-500">{t("agent.room.kept")}</p>
            </>
          )}
          {/* When the conversation was drawn from storage, say when it
              happened — B1179. The history panel grouped it under this date
              a moment earlier; the conversation itself should not lose it
              on the way in. Once, quietly, and only for reopened turns. */}
          {opened.length > 0 && opened[0].created_at && (
            <p className="text-xs font-semibold uppercase tracking-wide text-navy-500">
              {formatLongDate(opened[0].created_at.slice(0, 10))}
            </p>
          )}
          {turns.map((turn, index) => {
            const day = dayOf(turn.blocks);
            /** A quiet clock between exchanges ten minutes apart — B1212
             *  (D22). Client-only (`mounted`): a local-time string is the
             *  one thing server and browser cannot agree on. */
            const gapBefore =
              mounted &&
              turn.at !== undefined &&
              index > 0 &&
              turns[index - 1].at !== undefined &&
              turn.at - (turns[index - 1].at as number) >= 10 * 60 * 1000;
            return (
              <div
                key={index}
                ref={index === turns.length - 1 ? turnTop : undefined}
                className={
                  index === turns.length - 1
                    ? "scroll-mt-24 space-y-2"
                    : "space-y-2"
                }
              >
                {gapBefore && (
                  <p aria-hidden className="text-center text-xs text-navy-400">
                    {new Date(turn.at as number).toLocaleTimeString(undefined, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                )}
                {turn.said !== "" && (
                  /* The person's own sentence as a quiet bubble on the
                     right — B1212 (D02): scannable without avatars or a
                     voice on the other side; the answer stays plain text. */
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-cream-100 px-3.5 py-2 text-base leading-6 text-navy-800">
                    <span className="sr-only">{t("agent.chat.you")}: </span>
                    {turn.said}
                    {/* Only a turn that came over WhatsApp is marked — B1344
                        (E08): the web is the normal case and stays bare. */}
                    {turn.via === "whatsapp" && <WhatsAppMark label={t("agent.chat.viaWhatsapp")} />}
                  </p>
                )}
                {turn.blocks.map((block, n) => (
                  <BlockView
                    key={n}
                    block={block}
                    /*
                      The **first** proposal of the turn, not every one of them
                      — B918. One ref shared by all of them is assigned in DOM
                      order, so it ended up on whichever mounted last: a turn
                      carrying `start_day` then `draft_words` focused the
                      second, and the first — which has to be pressed first —
                      sat before the focus point, where tabbing forward never
                      reaches it.
                    */
                    focusRef={
                      index === turns.length - 1 &&
                      turn.blocks.findIndex(isProposal) === n
                        ? proposal
                        : undefined
                    }
                    busy={busy}
                    onChoose={(label) => {
                      setSaid(label);
                      box.current?.focus();
                    }}
                    onAccept={accept}
                  />
                ))}
                {/*
                  What used to be a header pill is this, now — B1016. The
                  owner's own reading: "a really small emoji or thumbnail in
                  the chat with a button Preview, and not a button at the
                  top." The day a turn names travels with the turn rather
                  than living in chrome above the whole conversation.
                */}
                {day && onPreview && (
                  <DayChip
                    date={dateOf(turn.blocks)}
                    photoSrc={
                      dayPhoto && dayPhoto.trip === day.trip && dayPhoto.slug === day.slug
                        ? dayPhoto.src
                        : null
                    }
                    onPress={() => onPreview(day)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Something honest while it thinks — silence reads as broken. B1124
          draws it, and the sentence stays for a screen reader even where the
          drawing is `aria-hidden`. */}
      {busy && (
        <>
          <p role="status" className="sr-only">
            {status || t("agent.chat.working")}
          </p>
          <TurnLoader shape={waitShape} status={waitShape === "waymark" ? status : undefined} />
        </>
      )}

      {/* The files strip, above the composer rather than beside the
          conversation — B1016. The room draws it; this is only where "above
          the field" is, since the field's own footer is built here. */}
      {suggestions.length > 0 && (
        /* What usually comes next, offered once — B1212 (D18): a
           deterministic set per kind of write, no model involved. A chip
           is a shortcut for typing its own words. */
        <div className="mb-2 flex flex-wrap gap-2">
          {suggestions.map((one, index) => {
            const label = typeof one === "string" ? one : one.label;
            return (
              <button
                key={typeof one === "string" ? one : `${"tool" in one ? one.tool : "share"}-${index}`}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (typeof one === "string") return go(one);
                  if ("share" in one) {
                    void navigator.share?.({ url: one.share });
                    return;
                  }
                  onProposal?.(one.tool, one.args);
                }}
                className="min-h-9 rounded-full border border-navy-300 bg-white px-3.5 text-sm text-navy-800 transition-colors hover:bg-navy-50 disabled:opacity-50"
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {notice}
      {filesStrip}

      {/* `relative`, because the microphone pins itself to this box's top
          right corner — see `RecordButton`'s `compact`. `sticky` so the field
          stays under the thread as it grows rather than being scrolled off
          the end of it. */}
      <div className="sticky bottom-0 rounded-xl border border-navy-200 bg-white p-2 shadow-sm">
        {/**
         * The field on its own row, full width, so it is legible to read
         * from and to type into on a phone — B1252. Files, the microphone
         * and send sit together on a row beneath it, grouped rather than
         * split to either edge, so the field is never squeezed for
         * corner space (B1211 D13/D14/D15 for what each control is).
         */}
        <div className="flex flex-col gap-1.5">
          <textarea
            ref={box}
            id={`ask-${username}`}
            rows={1}
            value={said}
            aria-label={t("agent.askOpen")}
            onChange={(event) => setSaid(event.target.value)}
            onFocus={() => {
              if (silentFocus.current) {
                silentFocus.current = false;
                return;
              }
              onFieldFocusChange?.(true);
            }}
            onBlur={() => onFieldFocusChange?.(false)}
            onKeyDown={(event) => {
              // Enter sends on a fine pointer; on a phone the return key
              // breaks the line and the button sends — B1211 (D13).
              if (event.key === "Enter" && !event.shiftKey && !coarse) {
                event.preventDefault();
                go();
              }
            }}
            placeholder={t("agent.askPlaceholder")}
            className="max-h-[152px] min-h-11 w-full resize-none rounded-2xl bg-transparent px-3 py-2.5 text-base leading-6 text-navy-900 placeholder:text-navy-500 focus:outline-none"
          />
          {/* `flex-wrap` — B1378. Voice mode adds a language select to this
              row (see `RecordButton`'s compact form); at 6rem and shrink-0
              beside the paperclip, mic and send, it left them squeezed. The
              select now asks for a whole line to itself (`basis-full`) and
              wraps below rather than fighting them for space. */}
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {onOpenFiles && (
              <button
                type="button"
                onClick={onOpenFiles}
                aria-label={t("agent.room.files")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-900 lg:hidden"
              >
                <Paperclip className="h-5 w-5" aria-hidden />
              </button>
            )}
            {speech && (
              <RecordButton
                username={username}
                consented={consentedSpeech}
                provider={speechProvider}
                disabled={busy}
                compact
                // Static in the row rather than pinned to a corner — B1211
                // (D15): the microphone is a full-size control beside send.
                compactClassName="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-navy-300 bg-white"
                onText={(spoken) => {
                  // Added to what is already there rather than replacing it —
                  // B893. A turn is often spoken in two goes, or typed and then
                  // finished out loud, and a transcript that overwrote the field
                  // threw the first half away without saying so.
                  setSaid((was) =>
                    was.trim() === "" ? spoken : `${was.trim()} ${spoken}`,
                  );
                  setHeard(spoken);
                  box.current?.focus();
                }}
                onSettled={onCreditsSettled}
              />
            )}
            <BusyButton
              busy={busy}
              type="button"
              disabled={said.trim() === ""}
              onClick={() => go()}
              aria-label={t("agent.askGo")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-navy-900 transition-colors hover:bg-yellow-300 disabled:opacity-40"
              busyLabel={null}
            >
              <ArrowUp className="h-5 w-5" aria-hidden />
            </BusyButton>
          </div>
        </div>

        {/* Where the transcript landed, said once — B893. A transcription is
            a guess, so a screen reader is told what was heard *and* that the
            box is where it gets corrected; the field itself announces
            nothing when its value changes. */}
        {heard !== "" && (
          <p role="status" className="mt-2 px-3 text-sm leading-6 text-navy-600">
            {t("agent.speechHeard", { said: heard })}
          </p>
        )}
      </div>

      {consenting && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("agent.helperConsentLabel")}
            question={t("agent.askConsentShort")}
            details={t("agent.askConsent")}
            confirmLabel={t("agent.helperConsentConfirm")}
            busy={busy}
            onConfirm={() => void consentThenAsk()}
            onCancel={() => setConsenting(false)}
          />
        </div>
      )}

      {lapsed && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-navy-50 p-3 text-base leading-6 text-navy-800"
        >
          {t("agent.askLapsed")}{" "}
          <a
            href={`/${encodeURIComponent(username)}/me`}
            className="font-semibold underline underline-offset-4"
          >
            {t("agent.askLapsedLink")}
          </a>
        </p>
      )}

      {error && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-coral-600">
          {error}
          {lastFailed !== "" && (
            /* One press to resend the same sentence — B1212 (D20). What
               failed is re-asked verbatim; nothing is retyped. */
            <button
              type="button"
              disabled={busy}
              onClick={() => void ask(lastFailed)}
              className="rounded-full border border-coral-400 px-3 py-1 text-sm font-semibold text-coral-600 transition-colors hover:bg-coral-50 disabled:opacity-50"
            >
              {t("agent.chat.retry")}
            </button>
          )}
        </p>
      )}
    </section>
  );
}

/**
 * The small thing a turn carries when it named a day — B1016.
 *
 * The owner's own words were "a really small emoji or thumbnail in the chat
 * with a button Preview, and not a button at the top", and this is that: a
 * photograph when the room already has one loaded for exactly this day (the
 * same read `PreviewPane` draws from, handed down as `dayPhoto`), a plain
 * marker otherwise. It never fetches on its own — a turn about a day the room
 * is not currently looking at would need a second network call to draw a
 * thumbnail nobody asked to see, and a marker with the date said just as much.
 */
function DayChip({
  date,
  photoSrc,
  onPress,
}: {
  date: string | null;
  photoSrc: string | null;
  onPress: () => void;
}) {
  const { t, formatShortDate } = useI18n();
  // The page's own locale, not the OS one — B1169. This chip renders on the
  // client only so it cannot mismatch, but the date should read in the
  // language the rest of the page is in.
  const when = date ? formatShortDate(date) : null;
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex min-h-11 items-center gap-2 rounded-full border border-navy-300 bg-white py-1 pl-1 pr-3 text-sm text-navy-800 transition-colors hover:bg-navy-50"
    >
      <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-cream-200" aria-hidden>
        {photoSrc ? (
          // `width`/`height`, not `fill` — B1298. `fill` plus a fixed
          // `sizes` string left next/image's 1x/2x/3x candidates uncapped,
          // and `mediaLoader` served whatever width was asked for a 32px
          // avatar (measured: 117KB at the 2000px candidate for a 38px
          // thumbnail). A fixed size's candidates all floor to
          // MEDIA_WIDTHS' own 320px minimum instead.
          <Image src={photoSrc} loader={mediaLoader} alt="" width={32} height={32} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-sm">📍</span>
        )}
      </span>
      {when ? (
        <span>
          <span className="sr-only">{t("agent.room.preview")}: </span>
          {when}
        </span>
      ) : (
        <span>{t("agent.room.preview")}</span>
      )}
    </button>
  );
}

/** How many rows of a `choose` block show before "show more" — B1122. Four is
 *  a screenful at 390px with the row height this needs for a thumb. */
const CHOOSE_ROWS_SHOWN = 4;

/**
 * A `choose` block, drawn as full-width rows rather than desktop-sized
 * chips — B1122. It is the block people meet most, and on a phone tapping
 * beats typing, so its rows are bigger than a desktop control would need to
 * be, not smaller: at least 44px tall, the label on the left and the date (if
 * any) on the right. A long list cuts to four and offers "show more" rather
 * than pushing the field below the fold.
 *
 * **A day with no title reads once, not twice.** `days`, `unfinished` and
 * `find_day` all fall back to something that repeats the date when a day has
 * no title of its own — the fallback is read here, from the shape every one
 * of them already sends (a `label` that is empty or identical to its own
 * `detail`), so a fix here covers all three without touching any of them.
 * What gets **said** if the row is pressed is unchanged: the tool's own
 * label, exactly as it always was, because it still has to identify the row
 * to the model even when this screen shows something friendlier instead.
 */
function ChooseBlock({
  text,
  options,
  onChoose,
}: {
  text: string;
  options: Option[];
  onChoose: (label: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? options : options.slice(0, CHOOSE_ROWS_SHOWN);
  const rowClass =
    "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-navy-300 bg-white px-4 py-2 text-left text-base text-navy-800 transition-colors hover:bg-navy-50";

  return (
    <div>
      <p className="text-base leading-6 text-navy-800">{text}</p>
      <ul className="mt-2 space-y-2">
        {shown.map((option) => {
          const untitled = option.label === "" || option.label === option.detail;
          const row = (
            <>
              <span>{untitled ? t("agent.chat.noTitle") : option.label}</span>
              {option.detail && (
                <span className="shrink-0 text-sm text-navy-600">{option.detail}</span>
              )}
            </>
          );
          return (
            <li key={option.value}>
              {/* `href` navigates rather than filling the box — B1022, see
                  the note on `Option` in lib/helper/blocks.ts. */}
              {option.href ? (
                <a href={option.href} className={rowClass}>
                  {row}
                </a>
              ) : (
                <button type="button" onClick={() => onChoose(option.label)} className={rowClass}>
                  {row}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!expanded && options.length > CHOOSE_ROWS_SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 min-h-11 px-2 text-sm text-navy-600 underline underline-offset-4 transition-colors hover:text-navy-900"
        >
          {t("agent.chat.showMore")}
        </button>
      )}
    </div>
  );
}

/**
 * One block, drawn.
 *
 * The seven shapes and nothing else — a tool that declared an eighth would
 * fall through to its own sentence rather than to a blank space, which is why
 * every block carries `text`. `form` and `confirm` are read-only until B900:
 * a write tool has no `run`, so nothing has happened, and a button that looked
 * pressable before it worked would be the one lie this surface cannot afford.
 */
function BlockView({
  block,
  focusRef,
  busy,
  onChoose,
  onAccept,
}: {
  block: Block;
  focusRef?: React.RefObject<HTMLDivElement | null>;
  busy: boolean;
  onChoose: (label: string) => void;
  onAccept: (
    proposal: Proposal,
    values: Record<string, string>,
  ) => Promise<void>;
}) {
  const { t } = useI18n();

  if (block.shape === "choose") {
    return <ChooseBlock text={block.text} options={block.options} onChoose={onChoose} />;
  }

  if (block.shape === "preview") {
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-3">
        <p className="text-sm text-navy-600">{block.text}</p>
        {/**
         * Through `AnswerText`, like every other line the model writes —
         * B1162.
         *
         * B1120 taught the model that `> ` means *words that came out of the
         * journal, and only that*, and this is the block where a day is
         * actually quoted — so it was the one place the new mark was most
         * likely to be used and the one place it was drawn raw. A person read
         * `> Thirteen hours, a bunk with a curtain…`, marker and all, on the
         * live site the same day.
         *
         * These lines are the model's own prose about a day, not the day's
         * stored markdown — `PreviewPane` is what draws a day as its reader
         * meets it. So rendering the four marks here is drawing what was
         * written rather than reinterpreting somebody's file.
         */}
        {block.lines.map((line, n) => (
          <div key={n} className="mt-1 break-words">
            <AnswerText text={line} />
          </div>
        ))}
      </div>
    );
  }

  if (block.shape === "files") {
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-3">
        <p className="text-sm text-navy-600">{block.text}</p>
        <ul className="mt-1 space-y-1">
          {block.files.map((file) => (
            <li key={file.id} className="text-base leading-6 text-navy-900">
              {file.name}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.shape === "link") {
    return (
      <div>
        <p className="text-base leading-6 text-navy-800">{block.text}</p>
        <a
          href={block.href}
          className="mt-1 inline-block min-h-11 text-base font-semibold text-navy-800 underline underline-offset-4"
        >
          {block.label}
        </a>
      </div>
    );
  }

  if (block.shape === "form" || block.shape === "confirm") {
    if (!block.proposal) {
      // A proposal the server did not attach one to cannot be pressed, and
      // saying so is better than a button that does nothing.
      return (
        <div className="rounded-xl border border-navy-200 bg-white p-4">
          <p className="text-base leading-6 text-navy-900">{block.text}</p>
          <p className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.chat.nothingWritten")}
          </p>
        </div>
      );
    }
    return (
      <ProposalView
        proposal={block.proposal}
        // A form draws all its fields; a confirmation draws only the
        // questions its route cannot go through without — B929.
        fields={block.fields ?? []}
        focusRef={focusRef}
        busy={busy}
        onAccept={onAccept}
      />
    );
  }

  return <AnswerText text={block.text} />;
}

/**
 * One proposal, editable, with one button — B900.
 *
 * **Editable is half of it and the smaller half.** A field can be typed over,
 * and a proposal can also be corrected by saying what is wrong: that sentence
 * goes into the field below like any other and comes back as a fresh proposal.
 * Both are here because they answer different moments — a wrong date is faster
 * to fix with a thumb, and a wrong *idea* is faster to fix with a sentence.
 *
 * **Nothing is written until the button.** Leaving it alone writes nothing and
 * costs nothing, which is what the second control says: it is not a cancel of
 * something in flight, it is a way to stop looking at it.
 *
 * Native inputs throughout — `type="date"`, a textarea, a `<select>` — because
 * the browser's own are reachable with a keyboard, announced by a screen
 * reader and usable at 390px with the on-screen keyboard up, and three
 * bespoke widgets would each have to earn that again.
 */
function ProposalView({
  proposal,
  fields,
  focusRef,
  busy,
  onAccept,
}: {
  proposal: Proposal;
  fields: ProposalField[];
  focusRef?: React.RefObject<HTMLDivElement | null>;
  busy: boolean;
  onAccept: (
    proposal: Proposal,
    values: Record<string, string>,
  ) => Promise<void>;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  // What happened to this particular proposal. A proposal that has been
  // pressed or set aside must stop being pressable, or the turn above it in
  // the thread becomes a button somebody can hit twice.
  const [settled, setSettled] = useState<"" | "accepted" | "left">("");
  /**
   * This card's own press, and this card's own refusal — B916.
   *
   * `setSettled("accepted")` used to fire before the fetch resolved, so the
   * card swapped irreversibly to "The day is started" and *then* the write
   * failed. "It was accepted" and "it is there" are not the same claim, and a
   * screen-reader user who has heard the first has no reason to keep
   * listening. Nothing settles now until the route has answered, and a
   * failure keeps the fields, re-enables the button and says what went wrong
   * beside them.
   */
  const [pressing, setPressing] = useState(false);
  const [failure, setFailure] = useState("");
  const alarm = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (failure !== "") alarm.current?.focus();
  }, [failure]);
  const id = `${proposal.tool}-${useId()}`;
  /**
   * A second press for what cannot be undone — B1391.
   *
   * A typed reply confirming the helper's own question ("löschen", "delete
   * them", "igen, töröld") used to be refused before it ever reached a
   * model, because a bare destruction word with nothing named alongside it
   * cannot be told apart from "delete my whole journal" — the very sentence
   * that guard exists to catch (`refusalFor` in `lib/helper/intents.ts`).
   * Rather than teach that guard to read the conversation for context, the
   * confirmation moves off free text entirely: the first press swaps the
   * accept row for a real `ConfirmPanel`, in place on this same card, and
   * only the second press writes. Nobody needs to type a confirmation at
   * all any more.
   *
   * `unpublish_day` is `destroy`-shaped by name (`decisionKind`) but stays
   * at one press: it changes `status:` and the day stays on disk as a
   * draft, so it is reversible in the one sense that matters here — nothing
   * this button does is unrecoverable.
   */
  const [confirming, setConfirming] = useState(false);

  // B1107 — a field the server already resolved (a trip id, a day slug, an
  // invite id) is not drawn at all: it still travels with the press inside
  // `values`, seeded from every field including this one, below.
  const editable = fields.filter((field) => !field.fixed);
  // B1394 — the rows to tick draw as their own list, not as slots in the
  // ordinary grid: each one's label is somebody's own name, not a field this
  // software asked for.
  const checkboxFields = editable.filter((field) => field.checkbox);
  const otherFields = editable.filter((field) => !field.checkbox);
  const setAllRows = (checked: boolean) =>
    setValues((was) => ({
      ...was,
      ...Object.fromEntries(checkboxFields.map((field) => [field.name, checked ? "1" : ""])),
    }));

  /**
   * The keyboard problem — B1122. While any field on *this* card has focus,
   * the accept button detaches from the card's own flow and pins itself to
   * the top of the visual viewport, which is where the keyboard's own top
   * edge is on both iOS and Android and on neither the browser bar nor a
   * hardware keyboard changes it: `window.visualViewport` reports the space
   * actually left for content, not a guessed keyboard height. `pinBottom` is
   * how far that edge sits from the *layout* viewport's bottom — `null` when
   * nothing on this card is focused, or the browser has no
   * `visualViewport` at all, in which case the button stays exactly where it
   * always sat.
   */
  const [fieldFocused, setFieldFocused] = useState(false);
  const [pinBottom, setPinBottom] = useState<number | null>(null);
  const fieldsBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = typeof window !== "undefined" ? window.visualViewport : undefined;
    // Syncing this card's own pin to whether one of its fields has focus —
    // the same disable `TripCountdown.tsx` already carries, for the same
    // reason: there is no external event to wait for when the answer is
    // "nothing is focused", so the sync happens here or not at all.
    if (!fieldFocused || !viewport) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPinBottom(null);
      return;
    }
    const update = () => {
      const gap = Math.max(0, window.innerHeight - (viewport.height + viewport.offsetTop));
      // No keyboard, no pin — B1337: on a desktop the visual viewport fills
      // the window (gap ≈ 0), and pinning there tore the buttons off the
      // card onto the page foot. 80px is safely below any real keyboard.
      setPinBottom(gap > 80 ? gap : null);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [fieldFocused]);

  if (settled !== "") {
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-4">
        <p className="text-base leading-6 text-navy-900">{proposal.sentence}</p>
        <p className="mt-2 text-sm leading-6 text-navy-600">
          {settled === "accepted" ? proposal.done : t("agent.chat.leftIt")}
        </p>
      </div>
    );
  }

  const kind = decisionKind(proposal.tool);
  const press = () => {
    setPressing(true);
    setFailure("");
    void onAccept(proposal, values)
      .then(() => {
        setSettled("accepted");
        // One short buzz where the platform allows it — B1220 (D41): the
        // moment something was actually written is the one worth feeling.
        navigator.vibrate?.(15);
      })
      .catch((thrown: unknown) => setFailure(failureSentence(t, (thrown as Error).message)))
      .finally(() => setPressing(false));
  };
  // B1391: `unpublish_day` alone stays reversible-and-one-press — see the
  // comment beside `confirming` above.
  const needsSecondPress = kind === "destroy" && proposal.tool !== "unpublish_day";
  const actions = confirming ? (
    <ConfirmPanel
      label={proposal.accept}
      question={t("agent.card.confirmDestroy")}
      confirmLabel={proposal.accept}
      busy={busy || pressing}
      busyLabel={t("agent.chat.writing")}
      onConfirm={press}
      onCancel={() => setConfirming(false)}
    />
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <BusyButton
        busy={busy || pressing}
        type="button"
        onClick={needsSecondPress ? () => setConfirming(true) : press}
        className="min-h-11 rounded-full bg-navy-800 px-5 text-base font-semibold text-cream-50 transition-colors hover:bg-navy-900 disabled:opacity-50"
        busyLabel={t("agent.chat.writing")}
      >
        {proposal.accept}
      </BusyButton>
      <button
        type="button"
        onClick={() => setSettled("left")}
        className="min-h-11 px-2 text-sm text-navy-600 underline underline-offset-4 transition-colors hover:text-navy-900"
      >
        {t("agent.chat.leaveIt")}
      </button>
    </div>
  );

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      /* White card, roomier padding — B1207 (D01 B): the proposal is the
         most important control on the screen and reads as one card now,
         its header ruled off from the sentence below. `scroll-mt-24` —
         B1253 — matches the sticky page header's height so scrolling this
         card's top into view lands it below the header, not under it. */
      className={`scroll-mt-24 rounded-xl border bg-white p-4 shadow-sm focus:outline-none ${
        kind === "edit" ? "border-navy-200" : "border-navy-200 border-t-4 border-t-coral-400"
      }`}
    >
      {/* An icon and a short title naming the kind of decision, above the
          sentence — B1122. The colour is the warning; this is the words. */}
      <p className="-mx-4 flex items-center gap-2 border-b border-navy-100 px-4 pb-2 text-sm font-semibold text-navy-700">
        <span aria-hidden>{DECISION_ICON[kind]}</span>
        {t(`agent.card.${kind}`)}
      </p>
      <p className="mt-1 text-base leading-6 text-navy-900">{proposal.sentence}</p>

      {checkboxFields.length > 0 && (
        <div className="mt-3">
          {checkboxFields.length > 1 && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setAllRows(true)}
                className="text-sm font-semibold text-navy-700 underline underline-offset-4"
              >
                {t("agent.chat.selectAll")}
              </button>
              <button
                type="button"
                onClick={() => setAllRows(false)}
                className="text-sm font-semibold text-navy-700 underline underline-offset-4"
              >
                {t("agent.chat.selectNone")}
              </button>
            </div>
          )}
          {/* Scrollable rather than a tower that swallows the card — B1394's
              own acceptance names twenty entries as the case that decides
              whether this is usable at all. */}
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-navy-200 bg-cream-50 p-2">
            {checkboxFields.map((field) => (
              <li key={field.name}>
                <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2 py-1 hover:bg-white">
                  <input
                    type="checkbox"
                    checked={values[field.name] === "1"}
                    onChange={(event) =>
                      setValues((was) => ({
                        ...was,
                        [field.name]: event.target.checked ? "1" : "",
                      }))
                    }
                    className="mt-0.5 h-5 w-5 shrink-0 rounded border-navy-300 text-navy-900"
                  />
                  <span className="text-base leading-6 text-navy-900">
                    {field.label ?? field.name}
                    {field.detail && (
                      <span className="block text-xs text-navy-500">{field.detail}</span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {otherFields.length > 0 && (
        <div
          ref={fieldsBox}
          onFocusCapture={() => setFieldFocused(true)}
          onBlurCapture={() => {
            // Deferred a tick: moving focus from one field on this card to
            // another fires blur before it fires the next field's focus, and
            // closing the pin in between would flash it shut and open again.
            window.setTimeout(() => {
              if (!fieldsBox.current?.contains(document.activeElement)) setFieldFocused(false);
            }, 0);
          }}
          /* Two columns from `sm` — B1207 (D05 B): a date and a title side
             by side instead of a tower; anything long spans the row. */
          className="mt-3 grid gap-3 sm:grid-cols-2"
        >
          {otherFields.map((field, index) => {
            const last = index === otherFields.length - 1;
            return (
              <div key={field.name} className={field.long ? "sm:col-span-2" : undefined}>
                <label
                  htmlFor={`${id}-${field.name}`}
                  className="block text-sm font-semibold text-navy-800"
                >
                  {t(`agent.slot.${field.name}` as TranslationKey)}
                </label>
                {field.options ? (
                  <select
                    id={`${id}-${field.name}`}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((was) => ({
                        ...was,
                        [field.name]: event.target.value,
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.long ? (
                  <textarea
                    id={`${id}-${field.name}`}
                    rows={6}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((was) => ({
                        ...was,
                        [field.name]: event.target.value,
                      }))
                    }
                    enterKeyHint={last ? "done" : "next"}
                    className="mt-1 w-full rounded-xl border border-navy-300 bg-white p-3 text-base leading-6 text-navy-900"
                  />
                ) : (
                  <input
                    id={`${id}-${field.name}`}
                    type={field.date ? "date" : "text"}
                    inputMode={field.date ? undefined : "text"}
                    enterKeyHint={last ? "done" : "next"}
                    value={values[field.name] ?? ""}
                    onChange={(event) =>
                      setValues((was) => ({
                        ...was,
                        [field.name]: event.target.value,
                      }))
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {failure !== "" && (
        <p
          ref={alarm}
          tabIndex={-1}
          role="alert"
          className="mt-3 text-sm leading-6 text-coral-600 focus:outline-none"
        >
          {failure}
        </p>
      )}

      {/* Pinned above the keyboard while a field on this card has focus, so
          the button that presses it is never the thing the keyboard covers
          — B1122. Off-screen otherwise, exactly where it always sat. */}
      <div className={pinBottom === null ? "mt-3" : "mt-3 invisible"} aria-hidden={pinBottom !== null}>
        {actions}
      </div>
      {pinBottom !== null && (
        <div
          className="fixed inset-x-0 z-40 border-t border-navy-200 bg-white p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.12)]"
          style={{ bottom: pinBottom }}
        >
          {actions}
        </div>
      )}

      <p className="mt-2 text-sm leading-6 text-navy-600">
        {t("agent.chat.orSayWhatIsWrong")}
      </p>
    </div>
  );
}

/** The WhatsApp glyph, inline — B1344 (E08). lucide dropped brand icons, so
 *  the path is drawn here; `role="img"` with the label is what a screen
 *  reader gets instead of the shape. */
function WhatsAppMark({ label }: { label: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      className="ml-1.5 inline-block h-3.5 w-3.5 align-[-2px] fill-navy-500"
    >
      <title>{label}</title>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}
