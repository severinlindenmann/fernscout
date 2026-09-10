import "server-only";
import type { Block } from "../helper/blocks";

/**
 * `Block[]` in, one WhatsApp message out — B1056.
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
 */

/** Meta's own ceilings — B1056. */
const MAX_BUTTONS = 3;
const BUTTON_TITLE_MAX = 20;
const MAX_LIST_ROWS = 10;
const LIST_ROW_TITLE_MAX = 24;

/** The preview truncation the day-announcement template already uses
 *  (`lib/digest/dayWhatsapp.ts:54`) — the owner's own answer to "how long is
 *  too long for a message", reused rather than re-decided. */
const PREVIEW_MAX = 300;

export type WhatsappOutbound =
  | { kind: "text"; body: string }
  | { kind: "buttons"; body: string; buttons: { id: string; title: string }[] }
  | { kind: "list"; body: string; buttonLabel: string; rows: { id: string; title: string }[] };

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
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
export function confirmButtonsFor(body: string, acceptLabel: string): WhatsappOutbound {
  return {
    kind: "buttons",
    body,
    buttons: [
      { id: CONFIRM_YES_ID, title: truncate(acceptLabel, BUTTON_TITLE_MAX) },
      { id: CONFIRM_NO_ID, title: "No" },
    ],
  };
}

/**
 * Render the whole answer as one WhatsApp message.
 *
 * `journalUrl` is where a `form` (and, past the ten-row ceiling, an
 * over-long `choose`) points — the room a browser can finish in.
 *
 * Blocks combine into a single message rather than one per block: WhatsApp
 * has no notion of "several messages that belong together" the way a chat
 * transcript does, and a `say` immediately followed by a `choose` reads as
 * one turn either way. The **first** interactive shape (a `choose` needing
 * buttons or a list, or a `confirm`) wins the message's own type — Meta
 * allows exactly one action per message — and everything before it becomes
 * that message's body text; anything after it is lost this turn, which is
 * the trade every tool here already accepts (a tool draws one block, almost
 * always, and `test/helper-whatsapp-render.test.ts` is what would catch two
 * interactive blocks arriving together).
 */
export function renderForWhatsapp(blocks: Block[], journalUrl: string): WhatsappOutbound {
  const lines: string[] = [];

  for (const block of blocks) {
    switch (block.shape) {
      case "say":
        lines.push(block.text);
        break;

      case "link":
        lines.push(`${block.text}\n${block.href}`);
        break;

      case "preview": {
        const body = truncate(block.lines.join(" — "), PREVIEW_MAX);
        lines.push([block.text, body].filter(Boolean).join("\n"));
        break;
      }

      case "files": {
        const rows = block.files.map((file) => `• ${file.name}`);
        lines.push([block.text, ...rows].join("\n"));
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
          lines.push([block.text, ...rows].join("\n"));
          break;
        }
        if (block.options.length <= MAX_BUTTONS) {
          return {
            kind: "buttons",
            body: [...lines, block.text].filter(Boolean).join("\n\n"),
            buttons: block.options.map((option, i) => ({
              id: optionId("choose", i, option.value),
              title: truncate(option.label, BUTTON_TITLE_MAX),
            })),
          };
        }
        if (block.options.length <= MAX_LIST_ROWS) {
          return {
            kind: "list",
            body: [...lines, block.text].filter(Boolean).join("\n\n"),
            buttonLabel: "Choose",
            rows: block.options.map((option, i) => ({
              id: optionId("choose", i, option.value),
              title: truncate(option.label, LIST_ROW_TITLE_MAX),
            })),
          };
        }
        // More than ten — text with the link, same escape hatch a `form`
        // takes past its own ceiling.
        lines.push(`${block.text}\n${journalUrl}`);
        break;
      }

      case "confirm":
        return confirmButtonsFor(
          [...lines, block.text].filter(Boolean).join("\n\n"),
          block.proposal?.accept ?? block.text,
        );

      case "form":
        // No WhatsApp shape — the escape hatch the owner chose for this
        // release. See the module doc.
        lines.push(`${block.text}\n${journalUrl}`);
        break;
    }
  }

  return { kind: "text", body: lines.filter(Boolean).join("\n\n") };
}
