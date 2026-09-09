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
 * own answer, quoted in the ticket. Tapping either sends its *title* back as
 * an ordinary message, the same "pressing one says its label" rule
 * `lib/helper/blocks.ts` documents for `choose` — which is also why a
 * confirm's accept never itself writes anything on this channel: nothing
 * downstream of a said sentence writes either, on the web or here, until a
 * press reaches the tool's own route. `lib/whatsapp/dispatch.ts` is where
 * that boundary is spelled out for a reader who has not seen this file yet.
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
 *  actually drives the next turn is the *title*, said back as though typed. */
function optionId(prefix: string, index: number, value: string): string {
  return `${prefix}:${index}:${value}`.slice(0, 200);
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

      case "confirm": {
        const accept = truncate(block.proposal?.accept ?? block.text, BUTTON_TITLE_MAX);
        return {
          kind: "buttons",
          body: [...lines, block.text].filter(Boolean).join("\n\n"),
          buttons: [
            { id: optionId("confirm", 0, "yes"), title: accept },
            { id: optionId("confirm", 1, "no"), title: "No" },
          ],
        };
      }

      case "form":
        // No WhatsApp shape — the escape hatch the owner chose for this
        // release. See the module doc.
        lines.push(`${block.text}\n${journalUrl}`);
        break;
    }
  }

  return { kind: "text", body: lines.filter(Boolean).join("\n\n") };
}
