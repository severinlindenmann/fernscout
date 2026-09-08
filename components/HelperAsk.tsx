"use client";

import { useEffect, useId, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import RecordButton from "@/components/RecordButton";
import { useI18n } from "@/components/LocaleProvider";
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
        found && typeof found === "object" ? (found as Record<string, unknown>)[key] : undefined,
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
  const lines = [draft?.date, draft?.title].filter(
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

export default function HelperAsk({
  username,
  consented: initialConsent,
  speech,
  consentedSpeech,
  speechProvider,
  onJournal = false,
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
   * Whether this is one of the journal's own pages rather than `/agent` —
   * B844.
   *
   * Two words change, and both are about what is *beside* the field. On the
   * door it opens with "Or ask me something", because the alternative is the
   * buttons directly under it; on a day or a trip page there are no such
   * buttons, and the alternative a person has already found is Search. So the
   * line names what this is for, and a second line names the difference in one
   * word each: **Search finds. Asking changes.** They are deliberately not one
   * control — merging them is what made "fix a typo in tuesday" return six day
   * cards.
   */
  onJournal?: boolean;
}) {
  const { t } = useI18n();
  // Closed until somebody asks for it — B767. The one thing this card is for
  // is writing a day, and a text field competing with that button is a second
  // decision offered to somebody who has not made the first one.
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // B807 — told apart from every other failure, because it is the only one
  // with something the person can do about it. A man mid-write-up got
  // `not_your_journal` with nothing on the screen, read it as the software
  // being broken, and closed the tab.
  const [lapsed, setLapsed] = useState(false);
  const [turns, setTurns] = useState<Exchange[]>([]);
  const [consented, setConsented] = useState(initialConsent);
  const [consenting, setConsenting] = useState(false);

  // The field replaces the line that opened it, so without this focus falls to
  // `<body>` and the person is left exploring the page to find out whether
  // anything happened — B795. It carries its own label, so it is both the
  // announcement and the destination.
  const box = useRef<HTMLInputElement>(null);
  const proposal = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.focus();
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
    else box.current?.focus();
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
    else setError(t("agent.failed", { error: message }));
  }

  /** Draw one more exchange and empty the field, because the next sentence is
   *  a next sentence and not a correction of the last one. */
  function landed(blocks: Block[]) {
    setTurns((was) => [...was, { said, blocks }]);
    setSaid("");
  }

  async function send(url: string, body?: unknown, method = "POST"): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(json.error ?? response.status));
    return json;
  }

  async function ask() {
    setBusy(true);
    setError("");
    setLapsed(false);
    try {
      const body = await send(`/api/helper/${encodeURIComponent(username)}/ask`, {
        said,
        // Their today, not the server's: "in March" is answered from where
        // the person is standing.
        today: new Date().toISOString().slice(0, 10),
      });
      const blocks = (body.blocks as Block[] | undefined) ?? [];
      landed(blocks.length > 0 ? blocks : [{ shape: "say", text: t("agent.askUnknown") }]);
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
      const answer = await send(
        proposal.endpoint,
        { ...proposal.arguments, ...values },
        proposal.method,
      );

      // Memory only, and never a claim: the write has already happened above.
      await send(`/api/helper/${encodeURIComponent(username)}/proposal`, {
        tool: proposal.tool,
        arguments: { ...proposal.arguments, ...values },
        wrote: true,
      }).catch(() => ({}));

      if (proposal.next) {
        const carried: Record<string, string> = { ...proposal.arguments, ...values };
        for (const [name, path] of Object.entries(proposal.next.from)) {
          const found = at(answer, path);
          if (typeof found === "string" && found !== "") carried[name] = found;
        }
        const next = await send(`/api/helper/${encodeURIComponent(username)}/proposal`, {
          tool: proposal.next.tool,
          arguments: carried,
          today: new Date().toISOString().slice(0, 10),
        });
        setTurns((was) => [
          ...was,
          { said: "", blocks: [{ shape: "say", text: proposal.done }, ...((next.blocks ?? []) as Block[])] },
        ]);
        return;
      }

      setTurns((was) => [
        ...was,
        { said: "", blocks: [...previewOf(answer), { shape: "say", text: proposal.done }] },
      ]);
    } catch (thrown) {
      failed(thrown);
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
      await send(`/api/helper/${encodeURIComponent(username)}/ask`, undefined, "DELETE");
      setTurns([{ said: "", blocks: [{ shape: "say", text: t("agent.chat.startedOver") }] }]);
    } catch (thrown) {
      failed(thrown);
    } finally {
      setBusy(false);
    }
  }

  function go() {
    if (said.trim() === "" || busy) return;
    if (consented) void ask();
    else setConsenting(true);
  }

  const opener = onJournal ? t("agent.askHereOpen") : t("agent.askOpen");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`min-h-11 text-navy-700 underline underline-offset-4 transition-colors hover:text-navy-900 ${onJournal ? "text-xs font-semibold" : "mt-4 text-base"}`}
      >
        {opener}
      </button>
    );
  }

  return (
    <section aria-label={t("agent.chat.title")} className="mt-4">
      {/* One word each, and only where Search is the thing a person has
          already tried — B844. Not a merge and not a link: the two boxes stay
          two boxes, and this says which is which. */}
      {onJournal && (
        <p className="mb-2 text-sm leading-6 text-navy-600">{t("agent.askNotSearch")}</p>
      )}

      {/*
        The thread. `log` with `aria-live="polite"` announces each turn once as
        it is added — there is no streaming here, so there is nothing to
        announce per token. It scrolls itself rather than the page, which is
        what keeps the field still on a phone.
      */}
      {turns.length > 0 && (
        <div
          ref={log}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          className="mb-3 max-h-[60vh] space-y-4 overflow-y-auto"
        >
          {turns.map((turn, index) => (
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
                  focusRef={
                    index === turns.length - 1 && isProposal(block) ? proposal : undefined
                  }
                  busy={busy}
                  onChoose={(label) => {
                    setSaid(label);
                    box.current?.focus();
                  }}
                  onAccept={accept}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Something honest while it thinks — silence reads as broken. */}
      {busy && (
        <p role="status" className="mb-2 text-sm leading-6 text-navy-600">
          {t("agent.chat.working")}
        </p>
      )}

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
          aria-label={opener}
          onChange={(event) => setSaid(event.target.value)}
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
            onText={(heard) => setSaid(heard)}
          />
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
            onClick={go}
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
  onAccept: (proposal: Proposal, values: Record<string, string>) => Promise<void>;
}) {
  const { t } = useI18n();

  if (block.shape === "choose") {
    return (
      <div>
        <p className="text-base leading-6 text-navy-800">{block.text}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {block.options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                onClick={() => onChoose(option.label)}
                className="min-h-11 rounded-full border border-navy-300 bg-white px-4 text-base text-navy-800 transition-colors hover:bg-cream-100"
              >
                {option.label}
                {option.detail && (
                  <span className="ml-2 text-sm text-navy-600">{option.detail}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.shape === "preview") {
    return (
      <div className="rounded-xl border border-navy-200 bg-white p-3">
        <p className="text-sm text-navy-600">{block.text}</p>
        {block.lines.map((line, n) => (
          <p key={n} className="mt-1 text-base leading-6 text-navy-900">
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
          <p className="mt-2 text-sm leading-6 text-navy-600">{t("agent.chat.nothingWritten")}</p>
        </div>
      );
    }
    return (
      <ProposalView
        proposal={block.proposal}
        fields={block.shape === "form" ? block.fields : []}
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
  onAccept: (proposal: Proposal, values: Record<string, string>) => Promise<void>;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(fields.map((field) => [field.name, field.value])),
  );
  // What happened to this particular proposal. A proposal that has been
  // pressed or set aside must stop being pressable, or the turn above it in
  // the thread becomes a button somebody can hit twice.
  const [settled, setSettled] = useState<"" | "accepted" | "left">("");
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
                    setValues((was) => ({ ...was, [field.name]: event.target.value }))
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
                    setValues((was) => ({ ...was, [field.name]: event.target.value }))
                  }
                  className="mt-1 w-full rounded-xl border border-navy-300 bg-white p-3 text-base leading-6 text-navy-900"
                />
              ) : (
                <input
                  id={`${id}-${field.name}`}
                  type={field.date ? "date" : "text"}
                  value={values[field.name] ?? ""}
                  onChange={(event) =>
                    setValues((was) => ({ ...was, [field.name]: event.target.value }))
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BusyButton
          busy={busy}
          type="button"
          onClick={() => {
            setSettled("accepted");
            void onAccept(proposal, values);
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

      <p className="mt-2 text-sm leading-6 text-navy-600">{t("agent.chat.orSayWhatIsWrong")}</p>
    </div>
  );
}
