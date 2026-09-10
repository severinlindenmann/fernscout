import "server-only";
import type { Block, Proposal } from "../helper/blocks";

/**
 * `Block[]` in, an ORDERED SEQUENCE of WhatsApp messages out — B1056, and
 * B1261 corrected the shape.
 *
 * `components/HelperAsk.tsx`'s `BlockView` is the *other* implementation of
 * the same seam: it draws the seven shapes with native HTML controls, this
 * draws them with what WhatsApp actually has — a body of text, at most three
 * reply buttons of twenty characters each, or one list of at most ten rows.
 * Neither renderer knows the other exists, and adding a third channel is
 * dropping in a third file, not touching either of these — the precedent is
 * `importers/`.
 *
 * **The renderer decides between buttons and a list; the model is told
 * nothing about it** — the owner's own decision on B1056, because the prompt
 * is the scarcer resource.
 *
 * **`form` has no WhatsApp shape**, and the honest answer the owner chose is
 * a link into `/agent` rather than a WhatsApp Flow (a second definition of
 * every form, reviewed by Meta, that can drift from the first) or a
 * turn-per-field conversation (real, but a second conversational mode for
 * every write tool with more than one field — out of scope for this pass;
 * every `form` block takes the link for now, and the honesty guards still
 * hold because nothing here ever claims a field was collected that was not).
 *
 * **`confirm` is real buttons**: the accept sentence and a "no" — the owner's
 * own answer, quoted in the ticket. **Since B1230, tapping the accept button
 * on an ordinary journal write actually presses it** — `lib/whatsapp/
 * dispatch.ts` holds the waiting proposal and executes the same route the
 * web panel's own button posts to, the moment the reply arrives. Money and
 * irreversible flows (a postcard, a photobook, buying credits) are never
 * wired into that executor, so their buttons — where they have any — still
 * only echo a label back; `lib/whatsapp/dispatch.ts`'s own module doc says
 * which is which and why.
 *
 * `confirmButtonsFor` below is the one place a `WhatsappOutbound` carrying
 * these two buttons is built, so a `confirm` block and a `form`-shaped
 * proposal B1230 also gives buttons to (see `dispatch.ts`) end up with
 * identical ids and the identical 20-character ceiling on the accept label.
 *
 * **B1261 — one message per interactive shape, not one message for the whole
 * turn.** Meta's real ceiling is one interactive element per *message*, not
 * per turn: WhatsApp has no notion of "several messages that belong
 * together" the way a chat transcript does, but it has every notion of
 * sending several messages in a row. The old shape returned the first
 * interactive block and silently dropped everything after it — a real live
 * failure once a turn called both a listing tool and a proposing tool (the
 * scenario this ticket is named for). `renderForWhatsapp` now walks the
 * whole block list and returns a message per interactive shape encountered,
 * with the plain prose before it folded into that message's body exactly as
 * before, and returns to accumulating prose afterward for whatever follows.
 * Nothing is dropped any more; `capMessages` below is the one place that
 * still trims, and it says so rather than doing it silently.
 */

/** Meta's own ceilings — B1056. */
const MAX_BUTTONS = 3;
/** Exported so a typed reply can be compared against what the button
 *  actually shows — B1302: the accept button's own truncated title, not
 *  only the full `proposal.accept` sentence, is a valid typed "press". */
export const BUTTON_TITLE_MAX = 20;
const MAX_LIST_ROWS = 10;
const LIST_ROW_TITLE_MAX = 24;

/** The preview truncation the day-announcement template already uses
 *  (`lib/digest/dayWhatsapp.ts:54`) — the owner's own answer to "how long is
 *  too long for a message", reused rather than re-decided. */
const PREVIEW_MAX = 300;

/** At most this many messages leave `renderForWhatsapp` for one turn —
 *  B1261. Not Meta's own limit (there is none on messages sent in
 *  sequence); this instance's own choice about how many bubbles one reply
 *  should ever become before the honest answer is "there's more, go look". */
const MAX_MESSAGES = 3;

export type WhatsappOutbound =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { kind: "list"; body: string; buttonLabel: string; rows: { id: string; title: string }[] };

/** One message in the sequence, tagged with the write proposal its buttons
 *  belong to when it carries one — B1261. `lib/whatsapp/dispatch.ts` reads
 *  this to know which message to hold a tap against; a `choose` never
 *  carries one (see `Block`'s own doc: only a write tool's `confirm`/`form`
 *  ever does), so most messages carry `proposal: undefined`. */
export type WhatsappMessage = WhatsappOutbound & { proposal?: Proposal };

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  /**
   * At a word boundary, not mid-word — the dayflow scenario found button
   * titles truncated as "Für mich ausformuli…" and "Diesen Text speiche…",
   * each unreadable as a word. Cut at the last space inside the budget; only
   * a single word longer than the whole budget falls back to a hard cut,
   * because there is nowhere else to break it.
   */
  const cut = flat.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const trimmed = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed.trimEnd()}…`;
}

/** One id a button or row's reply carries — opaque to the model, read back
 *  by `lib/whatsapp/dispatch.ts` only to log which option this was; what
 *  actually drives the next turn is the *title*, said back as though typed.
 *  The exception is `confirm:0:yes` / `confirm:1:no`, below — B1230 reads
 *  those two exact ids back to decide whether a press happened, so they are
 *  never used for anything else. */
function optionId(prefix: string, index: number, value: string): string {
  return `${prefix}:${index}:${value}`.slice(0, 200);
}

/** The reply id a `confirm`'s accept button always carries — B1230.
 *  `lib/whatsapp/dispatch.ts` matches on this exact string rather than on the
 *  (locale-dependent, truncated) title, which is why it never changes shape
 *  regardless of what the button says. */
export const CONFIRM_YES_ID = optionId("confirm", 0, "yes");
/** Its decline counterpart. */
export const CONFIRM_NO_ID = optionId("confirm", 1, "no");

/**
 * The two-button message a `confirm` always sends — B1056, and now the one
 * place both the `confirm` shape below and `dispatch.ts`'s own `form`
 * fallback (B1230) build it, so the ids and the 20-character ceiling can
 * never drift between the two.
 */
export function confirmButtonsFor(body: string, acceptLabel: string, declineLabel: string): WhatsappOutbound {
  return {
    kind: "buttons",
    body,
    buttons: [
      { id: CONFIRM_YES_ID, title: truncate(acceptLabel, BUTTON_TITLE_MAX) },
      { id: CONFIRM_NO_ID, title: truncate(declineLabel, BUTTON_TITLE_MAX) },
    ],
  };
}

/**
 * Fold everything past `MAX_MESSAGES` into one honest link-out — B1261.
 *
 * The first `MAX_MESSAGES - 1` messages are kept as they were drawn. The
 * *last* message is always kept too, rather than being the one that gets
 * dropped: given how `blocks` is built (every read tool's own block, then
 * the turn's write proposal, then the model's own trailing prose — see
 * `lib/whatsapp/dispatch.ts`), the last message is the one most likely to
 * carry the turn's actual proposal or its final sentence, and dropping it
 * would be losing the thing the person most needs to see. Anything strictly
 * between those two groups is summarised in one line rather than sent.
 */
function capMessages(messages: WhatsappMessage[], journalUrl: string, moreText: string): WhatsappMessage[] {
  if (messages.length <= MAX_MESSAGES) return messages;
  const kept = messages.slice(0, MAX_MESSAGES - 1);
  const last = messages[messages.length - 1];
  const droppedCount = messages.length - MAX_MESSAGES;
  if (droppedCount > 0) {
    kept.push({ kind: "text", body: `${moreText} ${journalUrl}`.trim() });
  }
  kept.push(last);
  return kept;
}

/**
 * Render a whole turn as the ordered sequence of WhatsApp messages it takes
 * to say it — B1056, reshaped by B1261.
 *
 * `journalUrl` is where a `form` (and, past the ten-row ceiling, an
 * over-long `choose`) points — the room a browser can finish in. `moreText`
 * is the sentence `capMessages` above uses when there is more than
 * `MAX_MESSAGES` allows — passed in already translated, the same way
 * `declineLabel` always has been, so this file holds no English prose of its
 * own.
 *
 * **One message per interactive shape.** Plain blocks (`say`, `link`,
 * `preview`, `files`, an over-long `choose`, a `form`) accumulate into a
 * running body; hitting a `choose` that fits in buttons or a list, or a
 * `confirm`, flushes that accumulated body plus the block's own sentence as
 * one message of the interactive kind, and accumulation starts over for
 * whatever comes after it. Anything left over once every block has been
 * walked becomes one final `text` message. Nothing from `blocks` is dropped
 * any more — B1261's whole point — except by `capMessages`, and that says so.
 */
export function renderForWhatsapp(blocks: Block[], journalUrl: string, declineLabel: string, moreText = ""): WhatsappMessage[] {
  const messages: WhatsappMessage[] = [];

  // Shape kept alongside each line — B1236 — so a `confirm` at the end can
  // tell the raw dump that backs it (its own `preview`/`files` block) from
  // the model's own prose, which stays. Reset after every flush, so each
  // message's own `confirmBody` only ever sees what led up to *it*.
  let entries: { shape: Block["shape"]; text: string }[] = [];
  let lines: string[] = [];
  const push = (shape: Block["shape"], text: string) => {
    entries.push({ shape, text });
    lines.push(text);
  };
  const flush = () => {
    entries = [];
    lines = [];
  };

  /**
   * One clean message for a `confirm` — B1236.
   *
   * `blocks` for a write proposal is always `[preview?, files?, confirm]` (or
   * a subset), from `proposalFor` — and `preview.text` is the *same*
   * sentence `confirm.text` carries, with the itemised list appended. Read
   * live: the inbox dump, then the sentence, then that same sentence's own
   * list a second time, then the sentence a third time from `confirm`. A
   * `preview` or `files` block is dropped here rather than folded in,
   * because it exists to be read on a screen with room for a table, not
   * flattened into one WhatsApp bubble — the confirm's own sentence already
   * says what is being proposed. What remains (the model's own `say` prose)
   * stays, minus a line identical to the confirm's own sentence.
   */
  function confirmBody(finalText: string): string {
    const kept = entries
      .filter((entry) => entry.shape !== "preview" && entry.shape !== "files")
      .map((entry) => entry.text)
      .filter((text) => text.trim() !== finalText.trim());
    return [...kept, finalText].filter(Boolean).join("\n\n");
  }

  for (const block of blocks) {
    switch (block.shape) {
      case "say":
        push("say", block.text);
        break;

      case "link":
        push("link", `${block.text}\n${block.href}`);
        break;

      case "preview": {
        const body = truncate(block.lines.join(" — "), PREVIEW_MAX);
        push("preview", [block.text, body].filter(Boolean).join("\n"));
        break;
      }

      case "files": {
        const rows = block.files.map((file) => `• ${file.name}`);
        push("files", [block.text, ...rows].join("\n"));
        break;
      }

      case "choose": {
        // An `Option` carrying `href` is a place, not an answer — B1022 —
        // and there is nothing to reply-button toward on WhatsApp either:
        // rendered as text with the link, same as a `link` block would.
        if (block.options.some((option) => option.href)) {
          const rows = block.options.map((option) =>
            option.href ? `• ${option.label} — ${option.href}` : `• ${option.label}`,
          );
          push("choose", [block.text, ...rows].join("\n"));
          break;
        }
        if (block.options.length <= MAX_BUTTONS) {
          messages.push({
            kind: "buttons",
            body: [...lines, block.text].filter(Boolean).join("\n\n"),
            buttons: block.options.map((option, i) => ({
              id: optionId("choose", i, option.value),
              title: truncate(option.label, BUTTON_TITLE_MAX),
            })),
          });
          flush();
          break;
        }
        if (block.options.length <= MAX_LIST_ROWS) {
          messages.push({
            kind: "list",
            body: [...lines, block.text].filter(Boolean).join("\n\n"),
            buttonLabel: "Choose",
            rows: block.options.map((option, i) => ({
              id: optionId("choose", i, option.value),
              title: truncate(option.label, LIST_ROW_TITLE_MAX),
            })),
          });
          flush();
          break;
        }
        // More than ten — text with the link, same escape hatch a `form`
        // takes past its own ceiling.
        push("choose", `${block.text}\n${journalUrl}`);
        break;
      }

      case "confirm":
        messages.push({
          ...confirmButtonsFor(confirmBody(block.text), block.proposal?.accept ?? block.text, declineLabel),
          ...(block.proposal ? { proposal: block.proposal } : {}),
        });
        flush();
        break;

      case "form":
        // No WhatsApp shape — the escape hatch the owner chose for this
        // release. See the module doc.
        push("form", `${block.text}\n${journalUrl}`);
        break;
    }
  }

  const trailing = lines.filter(Boolean).join("\n\n");
  if (trailing !== "" || messages.length === 0) {
    messages.push({ kind: "text", body: trailing });
  }

  return capMessages(messages, journalUrl, moreText);
}
