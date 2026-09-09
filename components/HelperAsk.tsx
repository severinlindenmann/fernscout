"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import RecordButton from "@/components/RecordButton";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import RoomOpening from "@/components/RoomOpening";
import type { Opening } from "@/lib/helper/opening";
import type { Block, Proposal, ProposalField } from "@/lib/helper/blocks";
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
type Exchange = { said: string; blocks: Block[] };

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
function previewOf(answer: Record<string, unknown>): Block[] {
  const draft = answer.draft as Record<string, unknown> | undefined;
  // `url` is the invite link, and it is answered exactly once — B931. Read as
  // a field of the answer, like `draft` above, so this component still knows
  // the name of no tool.
  const lines = [draft?.date, draft?.title, answer.url].filter(
    (line): line is string => typeof line === "string" && line !== "",
  );
  return lines.length > 0 ? [{ shape: "preview", text: "", lines }] : [];
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
  "idempotency_conflict",
  "contacts_disabled",
  "helper_unavailable",
  "helper_disabled",
  "invalid_people",
  "too_many_requests",
  "invalid_json",
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
  onFieldFocusChange,
  inRoom = false,
  opened = [],
  opening,
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
  opened?: { said: string | null; answered: string | null }[];
  /** What the room says before anybody has said anything — B984. Absent under
   *  a journal's day card, where the conversation is not the whole page. */
  opening?: Opening;
}) {
  const { t } = useI18n();
  // Closed until somebody asks for it — B767. The one thing this card is for
  // is writing a day, and a text field competing with that button is a second
  // decision offered to somebody who has not made the first one.
  const [open, setOpen] = useState(inRoom);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
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
  const box = useRef<HTMLInputElement>(null);
  const proposal = useRef<HTMLDivElement>(null);
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

  // Where focus goes when a turn arrives: to a proposal if the turn ended in
  // one, because a proposal nobody is looking at is a proposal nobody presses;
  // to the field otherwise, because saying something else is the usual next
  // thing. An effect rather than a callback, so it runs after React has put
  // the block in the document and there is something to focus.
  useEffect(() => {
    const last = turns[turns.length - 1];
    if (!last) return;
    if (last.blocks.some(isProposal)) proposal.current?.focus();
    else {
      silentFocus.current = true;
      box.current?.focus();
    }
  }, [turns]);

  // Newest last, and the newest is what somebody wants to see. Scrolling the
  // thread rather than the page keeps the field where it was — the one thing
  // a conversation on a phone must not move.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [turns, busy]);

  /** The one failure with a way out of it, told apart from the rest — B807. */
  function failed(thrown: unknown) {
    const message = (thrown as Error).message;
    if (message === "session_lapsed") setLapsed(true);
    else setError(failureSentence(t, message));
  }

  /** Draw one more exchange and empty the field, because the next sentence is
   *  a next sentence and not a correction of the last one. */
  function landed(blocks: Block[], words = said) {
    setTurns((was) => [...was, { said: words, blocks }]);
    setSaid("");
    setHeard("");
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
    if (!response.ok) throw new Error(String(json.error ?? response.status));
    return json;
  }

  async function ask(override?: string) {
    // B984 — a chip in the opening sends its sentence through here rather than
    // through anything of its own. State would not have settled by the time
    // this ran, which is why the words are an argument and not a `setSaid`.
    const words = override ?? said;
    setBusy(true);
    setError("");
    setLapsed(false);
    try {
      const body = await send(
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
      failed(thrown);
    } finally {
      setBusy(false);
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
        const next = await send(
          `/api/helper/${encodeURIComponent(username)}/proposal`,
          {
            tool: proposal.next.tool,
            arguments: carried,
            today: new Date().toISOString().slice(0, 10),
          },
        );
        setTurns((was) => [
          ...was,
          {
            said: "",
            blocks: [
              { shape: "say", text: proposal.done },
              ...((next.blocks ?? []) as Block[]),
            ],
          },
        ]);
        return;
      }

      setTurns((was) => [
        ...was,
        {
          said: "",
          blocks: [...previewOf(answer), { shape: "say", text: proposal.done }],
        },
      ]);
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
    }
  }

  /** Start over — the `forget()` that has existed since B889 and that nothing
   *  called, so somebody who confused the thread waited half an hour. */
  async function startOver() {
    setBusy(true);
    setError("");
    try {
      await send(
        `/api/helper/${encodeURIComponent(username)}/ask`,
        undefined,
        "DELETE",
      );
      setTurns([
        {
          said: "",
          blocks: [{ shape: "say", text: t("agent.chat.startedOver") }],
        },
      ]);
    } catch (thrown) {
      failed(thrown);
    } finally {
      setBusy(false);
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
          className={`mb-3 space-y-4 overflow-y-auto ${inRoom ? "min-h-0 flex-1" : "max-h-[60vh]"}`}
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
              {opening && <RoomOpening opening={opening} onSay={go} />}
              <p className="mt-3 text-sm leading-6 text-navy-500">{t("agent.room.kept")}</p>
            </>
          )}
          {turns.map((turn, index) => {
            const day = dayOf(turn.blocks);
            return (
              <div key={index} className="space-y-2">
                {turn.said !== "" && (
                  <p className="text-sm leading-6 text-navy-600">
                    <span className="sr-only">{t("agent.chat.you")}: </span>
                    {turn.said}
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

      {/* Something honest while it thinks — silence reads as broken. */}
      {busy && (
        <p role="status" className="mb-2 text-sm leading-6 text-navy-600">
          {t("agent.chat.working")}
        </p>
      )}

      {/* The files strip, above the composer rather than beside the
          conversation — B1016. The room draws it; this is only where "above
          the field" is, since the field's own footer is built here. */}
      {filesStrip}

      {/* `relative`, because the microphone pins itself to this box's top
          right corner — see `RecordButton`'s `compact`. `sticky` so the field
          stays under the thread as it grows rather than being scrolled off
          the end of it. */}
      <div className="sticky bottom-0 rounded-2xl border border-navy-200 bg-white p-2">
        <input
          ref={box}
          id={`ask-${username}`}
          type="text"
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
            if (event.key === "Enter") go();
          }}
          placeholder={t("agent.askPlaceholder")}
          className={`min-h-11 w-full rounded-full bg-transparent px-3 text-base text-navy-900 placeholder:text-navy-500 ${
            speech ? "pr-14" : ""
          }`}
        />

        {/* B686 — the same record button the wizard's words step mounts, so the
            microphone drives the whole product rather than one field. What comes
            back fills the field, editable before it is sent; it is not asked
            until the person presses Ask. */}
        {speech && (
          <RecordButton
            username={username}
            consented={consentedSpeech}
            provider={speechProvider}
            disabled={busy}
            compact
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
          />
        )}

        {/* Where the transcript landed, said once — B893. A transcription is
            a guess, so a screen reader is told what was heard *and* that the
            box is where it gets corrected; the field itself announces
            nothing when its value changes. */}
        {heard !== "" && (
          <p role="status" className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.speechHeard", { said: heard })}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
          {turns.length > 0 && (
            <button
              type="button"
              onClick={() => void startOver()}
              disabled={busy}
              className="min-h-11 px-2 text-sm text-navy-600 underline underline-offset-4 transition-colors hover:text-navy-900 disabled:opacity-50"
            >
              {t("agent.chat.startOver")}
            </button>
          )}
          <BusyButton
            busy={busy}
            type="button"
            disabled={said.trim() === ""}
            // `() => go()`, not `go` itself — B1020 gave `go` an optional
            // argument for a chip's own words, and a bare `onClick={go}`
            // would have handed it the click's `MouseEvent` instead.
            onClick={() => go()}
            className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800 transition-colors hover:bg-cream-100 disabled:opacity-50"
            busyLabel={t("agent.askWorking")}
          >
            {t("agent.askGo")}
          </BusyButton>
        </div>
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
          className="mt-3 rounded-xl bg-cream-100 p-3 text-base leading-6 text-navy-800"
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
        <p role="status" className="mt-2 text-sm text-coral-600">
          {error}
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
  const { t } = useI18n();
  const when = date
    ? new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      })
    : null;
  return (
    <button
      type="button"
      onClick={onPress}
      className="flex min-h-11 items-center gap-2 rounded-full border border-navy-300 bg-white py-1 pl-1 pr-3 text-sm text-navy-800 transition-colors hover:bg-cream-100"
    >
      <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-cream-200" aria-hidden>
        {photoSrc ? (
          <Image src={photoSrc} loader={mediaLoader} alt="" fill sizes="32px" className="object-cover" />
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
    return (
      <div>
        <p className="text-base leading-6 text-navy-800">{block.text}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {block.options.map((option) => {
            const chip = (
              <>
                {option.label}
                {option.detail && (
                  <span className="ml-2 text-sm text-navy-600">
                    {option.detail}
                  </span>
                )}
              </>
            );
            const chipClass =
              "min-h-11 rounded-full border border-navy-300 bg-white px-4 text-base text-navy-800 transition-colors hover:bg-cream-100";
            return (
              <li key={option.value}>
                {/* `href` navigates rather than filling the box — B1022, see
                    the note on `Option` in lib/helper/blocks.ts. */}
                {option.href ? (
                  <a href={option.href} className={`inline-flex items-center ${chipClass}`}>
                    {chip}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() => onChoose(option.label)}
                    className={chipClass}
                  >
                    {chip}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (block.shape === "preview") {
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-3">
        <p className="text-sm text-navy-600">{block.text}</p>
        {block.lines.map((line, n) => (
          <p
            key={n}
            className="mt-1 break-words text-base leading-6 text-navy-900"
          >
            {line}
          </p>
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
        <div className="rounded-xl border border-navy-200 bg-cream-50 p-3">
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

  return <p className="text-base leading-6 text-navy-800">{block.text}</p>;
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

  if (settled !== "") {
    return (
      <div className="rounded-xl border border-navy-200 bg-cream-50 p-3">
        <p className="text-base leading-6 text-navy-900">{proposal.sentence}</p>
        <p className="mt-2 text-sm leading-6 text-navy-600">
          {settled === "accepted" ? proposal.done : t("agent.chat.leftIt")}
        </p>
      </div>
    );
  }

  return (
    <div
      ref={focusRef}
      tabIndex={-1}
      className="rounded-xl border border-navy-200 bg-cream-50 p-3 focus:outline-none"
    >
      <p className="text-base leading-6 text-navy-900">{proposal.sentence}</p>

      {fields.length > 0 && (
        <div className="mt-3 space-y-3">
          {fields.map((field) => (
            <div key={field.name}>
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
                  className="mt-1 w-full rounded-xl border border-navy-300 bg-white p-3 text-base leading-6 text-navy-900"
                />
              ) : (
                <input
                  id={`${id}-${field.name}`}
                  type={field.date ? "date" : "text"}
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
          ))}
        </div>
      )}

      {failure !== "" && (
        <p
          ref={alarm}
          tabIndex={-1}
          role="alert"
          className="mt-3 text-sm leading-6 text-coral-700 focus:outline-none"
        >
          {failure}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BusyButton
          busy={busy || pressing}
          type="button"
          onClick={() => {
            setPressing(true);
            setFailure("");
            void onAccept(proposal, values)
              .then(() => setSettled("accepted"))
              .catch((thrown: unknown) =>
                setFailure(failureSentence(t, (thrown as Error).message)),
              )
              .finally(() => setPressing(false));
          }}
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

      <p className="mt-2 text-sm leading-6 text-navy-600">
        {t("agent.chat.orSayWhatIsWrong")}
      </p>
    </div>
  );
}
