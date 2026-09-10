import { describe, expect, test } from "vitest";
import type { Block, Proposal } from "@/lib/helper/blocks";
import { renderForWhatsapp } from "@/lib/whatsapp/render";

/**
 * `Block[]` -> an ORDERED SEQUENCE of WhatsApp messages — B1056, reshaped by
 * B1261.
 *
 * The acceptance line, over the whole shape vocabulary rather than a sample:
 * `say`, `link`, `preview`, `files`, `choose` (both under and over three
 * options, and past ten), `confirm`, and `form` — each produces a payload
 * that respects Meta's own ceilings: three buttons, ten rows, twenty
 * characters per button title. Past that: every turn used to become exactly
 * one message, with everything after the first interactive shape silently
 * dropped — this file's second half is what replaced that with a message
 * per interactive shape, nothing dropped, and an honest cap when a turn
 * really does produce more than a few.
 */

const URL = "https://t.test/alex";
const DECLINE = "No";

const PROPOSAL: Proposal = {
  tool: "create_trip",
  arguments: { title: "Japan", start: "2027-03-01", end: "2027-03-14" },
  sentence: "A new trip to Japan, 1–14 March 2027.",
  fields: [],
  endpoint: "/api/helper/alex/trip",
  method: "POST",
  accept: "Make the trip",
  done: "Made.",
};

describe("say", () => {
  test("becomes one text message", () => {
    const out = renderForWhatsapp([{ shape: "say", text: "Hello there." }], URL, DECLINE);
    expect(out).toEqual([{ kind: "text", body: "Hello there." }]);
  });
});

describe("link", () => {
  test("becomes text carrying the URL", () => {
    const out = renderForWhatsapp(
      [{ shape: "link", text: "Here is the room.", href: "https://t.test/agent", label: "Open it" }],
      URL,
      DECLINE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    expect((out[0] as { body: string }).body).toContain("https://t.test/agent");
  });
});

describe("preview", () => {
  test("is truncated at 300 characters, matching the day-announcement template", () => {
    const long = Array.from({ length: 50 }, (_, i) => `sentence ${i}`);
    const out = renderForWhatsapp([{ shape: "preview", text: "The 2nd of May:", lines: long }], URL, DECLINE);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    const body = (out[0] as { body: string }).body;
    expect(body.length).toBeLessThan(340);
    expect(body).toContain("…");
  });
});

describe("files", () => {
  test("becomes a bulleted list of names, as text", () => {
    const out = renderForWhatsapp(
      [{ shape: "files", text: "Two files waiting:", files: [{ id: "a", name: "statement.csv" }, { id: "b", name: "gpx.gpx" }] }],
      URL,
      DECLINE,
    );
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    const body = (out[0] as { body: string }).body;
    expect(body).toContain("statement.csv");
    expect(body).toContain("gpx.gpx");
  });
});

describe("choose", () => {
  test("three or fewer options become reply buttons, titles capped at 20 characters", () => {
    const block: Block = {
      shape: "choose",
      text: "Which day do you mean?",
      options: [
        { value: "a", label: "The first of May, a very long day indeed" },
        { value: "b", label: "The second of May" },
      ],
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("buttons");
    const msg = out[0];
    if (msg.kind !== "buttons") throw new Error("unreachable");
    expect(msg.buttons).toHaveLength(2);
    for (const button of msg.buttons) expect(button.title.length).toBeLessThanOrEqual(20);
  });

  test("four to ten options become a list", () => {
    const block: Block = {
      shape: "choose",
      text: "Pick one:",
      options: Array.from({ length: 7 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })),
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    const msg = out[0];
    expect(msg.kind).toBe("list");
    if (msg.kind !== "list") throw new Error("unreachable");
    expect(msg.rows).toHaveLength(7);
    expect(msg.rows.length).toBeLessThanOrEqual(10);
  });

  test("more than ten falls back to text with a link", () => {
    const block: Block = {
      shape: "choose",
      text: "Pick one:",
      options: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })),
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    expect((out[0] as { body: string }).body).toContain(URL);
  });

  test("an option carrying href — a place, not an answer — is text with the link, never a button", () => {
    const block: Block = {
      shape: "choose",
      text: "Your past conversations:",
      options: [{ value: "c1", label: "Yesterday", href: "https://t.test/agent?c=c1" }],
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out[0].kind).toBe("text");
    expect((out[0] as { body: string }).body).toContain("https://t.test/agent?c=c1");
  });
});

describe("confirm", () => {
  test("becomes two reply buttons: the accept sentence and No", () => {
    const block: Block = { shape: "confirm", text: "Make the trip?", proposal: PROPOSAL };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.kind).toBe("buttons");
    if (msg.kind !== "buttons") throw new Error("unreachable");
    expect(msg.buttons[0].title).toBe("Make the trip");
    expect(msg.buttons[1].title).toBe("No");
    // B1261 — tagged with the proposal its buttons belong to, so
    // `lib/whatsapp/dispatch.ts` knows which message to hold a tap against.
    expect(msg.proposal).toBe(PROPOSAL);
  });

  test("with no proposal, falls back to its own text as the accept button", () => {
    const block: Block = { shape: "confirm", text: "Take the 4th off the site?" };
    const out = renderForWhatsapp([block], URL, DECLINE);
    const msg = out[0];
    expect(msg.kind).toBe("buttons");
    if (msg.kind !== "buttons") throw new Error("unreachable");
    expect(msg.buttons[0].title.length).toBeLessThanOrEqual(20);
    expect(msg.proposal).toBeUndefined();
  });

  /**
   * B1236 — the live bug: an `inbox` read's `files` dump, then
   * `attach_files`'s own `preview` (the same sentence, plus the list a
   * second time), then `confirm` carrying that sentence a third time.
   */
  test("says the proposal sentence once, and drops the raw preview/files dumps that back it", () => {
    const sentence = "Putting 1 photograph onto the 10th of September.";
    const blocks: Block[] = [
      { shape: "files", text: "Waiting in the inbox:", files: [{ id: "a", name: "whatsapp-photo.jpg" }] },
      { shape: "preview", text: sentence, lines: ["2026-09-10 — 2026-09-10", "whatsapp-photo.jpg"] },
      { shape: "confirm", text: sentence, proposal: PROPOSAL },
    ];
    const out = renderForWhatsapp(blocks, URL, DECLINE);
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.kind).toBe("buttons");
    if (msg.kind !== "buttons") throw new Error("unreachable");
    const occurrences = msg.body.split(sentence).length - 1;
    expect(occurrences).toBe(1);
    expect(msg.body).not.toContain("whatsapp-photo.jpg");
    expect(msg.body).not.toContain("—");
  });

  test("keeps the model's own prose ahead of the sentence", () => {
    const sentence = "Putting 1 photograph onto the 10th of September.";
    const blocks: Block[] = [
      { shape: "say", text: "Sure, here it is." },
      { shape: "confirm", text: sentence, proposal: PROPOSAL },
    ];
    const out = renderForWhatsapp(blocks, URL, DECLINE);
    const msg = out[0];
    expect(msg.kind).toBe("buttons");
    if (msg.kind !== "buttons") throw new Error("unreachable");
    expect(msg.body).toBe("Sure, here it is.\n\nPutting 1 photograph onto the 10th of September.");
  });
});

describe("form", () => {
  test("has no WhatsApp shape and becomes text with the room's link", () => {
    const block: Block = {
      shape: "form",
      text: "A few things I need:",
      fields: [{ name: "title", value: "" }],
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("text");
    expect((out[0] as { body: string }).body).toContain(URL);
  });
});

describe("a say followed by an interactive block", () => {
  test("combine into one message, the interactive shape winning the message type", () => {
    const out = renderForWhatsapp(
      [
        { shape: "say", text: "Got it." },
        { shape: "choose", text: "Which trip?", options: [{ value: "a", label: "Japan" }] },
      ],
      URL,
      DECLINE,
    );
    expect(out).toHaveLength(1);
    const msg = out[0];
    expect(msg.kind).toBe("buttons");
    if (msg.kind !== "buttons") throw new Error("unreachable");
    expect(msg.body).toContain("Got it.");
    expect(msg.body).toContain("Which trip?");
  });
});

/**
 * B1261 — the ctxloss scenario's own reproduction: a turn that calls a read
 * tool drawing a `choose` (a trip picker) and a write tool drawing a
 * `confirm` (a day proposal) in the same turn. The old renderer sent the
 * `choose` and silently dropped the `confirm` and every word of prose after
 * it. Now both arrive, in order, each with its own real buttons.
 */
describe("two interactive shapes in one turn", () => {
  test("each becomes its own message, in order, and nothing is dropped", () => {
    const blocks: Block[] = [
      { shape: "choose", text: "Which trip?", options: [{ value: "a", label: "Daily Updates" }] },
      { shape: "confirm", text: "Start the 11th?", proposal: PROPOSAL },
      { shape: "say", text: "Once you press, the day is ready." },
    ];
    const out = renderForWhatsapp(blocks, URL, DECLINE);
    expect(out).toHaveLength(3);
    expect(out[0].kind).toBe("buttons");
    expect((out[0] as { body: string }).body).toContain("Which trip?");
    expect(out[0].proposal).toBeUndefined();
    expect(out[1].kind).toBe("buttons");
    expect((out[1] as { body: string }).body).toContain("Start the 11th?");
    expect(out[1].proposal).toBe(PROPOSAL);
    expect(out[2]).toEqual({ kind: "text", body: "Once you press, the day is ready." });
  });
});

describe("more interactive shapes than the cap allows", () => {
  test("keeps the first two, collapses the rest into one honest link, and never drops the last", () => {
    const blocks: Block[] = [
      { shape: "choose", text: "Which trip?", options: [{ value: "a", label: "Japan" }] },
      { shape: "choose", text: "Which day?", options: [{ value: "b", label: "Monday" }] },
      { shape: "choose", text: "Which photo?", options: [{ value: "c", label: "The first" }] },
      { shape: "confirm", text: "Save it?", proposal: PROPOSAL },
    ];
    const out = renderForWhatsapp(blocks, URL, DECLINE, "There's more than fits here — see the rest at");
    // Two kept, one collapsed note, and the last (the proposal) always kept.
    expect(out.length).toBe(4);
    expect(out[0].kind).toBe("buttons");
    expect(out[1].kind).toBe("buttons");
    expect(out[2]).toEqual({ kind: "text", body: `There's more than fits here — see the rest at ${URL}` });
    expect(out[3].kind).toBe("buttons");
    expect(out[3].proposal).toBe(PROPOSAL);
  });
});

describe("a button title too long to fit", () => {
  test("truncates at a word boundary, never mid-word", () => {
    const block: Block = {
      shape: "confirm",
      text: "Save it?",
      proposal: { ...PROPOSAL, accept: "Für mich ausformulieren lassen" },
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    const msg = out[0];
    if (msg.kind !== "buttons") throw new Error("unreachable");
    const title = msg.buttons[0].title;
    expect(title.length).toBeLessThanOrEqual(20);
    // No truncation lands mid-word: strip the ellipsis and the remainder is
    // whole words only, i.e. it does not end with a partial fragment that
    // the un-truncated label doesn't have as a whole word right there.
    const withoutEllipsis = title.replace(/…$/, "");
    expect("Für mich ausformulieren lassen".startsWith(withoutEllipsis)).toBe(true);
    expect(withoutEllipsis.endsWith(" ")).toBe(false);
    expect("Für mich ausformulieren lassen".split(" ")).toContain(withoutEllipsis.split(" ").at(-1));
  });
});
