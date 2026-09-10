import { describe, expect, test } from "vitest";
import type { Block, Proposal } from "@/lib/helper/blocks";
import { renderForWhatsapp } from "@/lib/whatsapp/render";

/**
 * `Block[]` -> a WhatsApp payload — B1056.
 *
 * The acceptance line, over the whole shape vocabulary rather than a sample:
 * `say`, `link`, `preview`, `files`, `choose` (both under and over three
 * options, and past ten), `confirm`, and `form` — each produces a payload
 * that respects Meta's own ceilings: three buttons, ten rows, twenty
 * characters per button title.
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
  test("becomes text", () => {
    const out = renderForWhatsapp([{ shape: "say", text: "Hello there." }], URL, DECLINE);
    expect(out).toEqual({ kind: "text", body: "Hello there." });
  });
});

describe("link", () => {
  test("becomes text carrying the URL", () => {
    const out = renderForWhatsapp(
      [{ shape: "link", text: "Here is the room.", href: "https://t.test/agent", label: "Open it" }],
      URL,
      DECLINE,
    );
    expect(out.kind).toBe("text");
    expect((out as { body: string }).body).toContain("https://t.test/agent");
  });
});

describe("preview", () => {
  test("is truncated at 300 characters, matching the day-announcement template", () => {
    const long = Array.from({ length: 50 }, (_, i) => `sentence ${i}`);
    const out = renderForWhatsapp([{ shape: "preview", text: "The 2nd of May:", lines: long }], URL, DECLINE);
    expect(out.kind).toBe("text");
    const body = (out as { body: string }).body;
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
    expect(out.kind).toBe("text");
    const body = (out as { body: string }).body;
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
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    expect(out.buttons).toHaveLength(2);
    for (const button of out.buttons) expect(button.title.length).toBeLessThanOrEqual(20);
  });

  test("four to ten options become a list", () => {
    const block: Block = {
      shape: "choose",
      text: "Pick one:",
      options: Array.from({ length: 7 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })),
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out.kind).toBe("list");
    if (out.kind !== "list") throw new Error("unreachable");
    expect(out.rows).toHaveLength(7);
    expect(out.rows.length).toBeLessThanOrEqual(10);
  });

  test("more than ten falls back to text with a link", () => {
    const block: Block = {
      shape: "choose",
      text: "Pick one:",
      options: Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` })),
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out.kind).toBe("text");
    expect((out as { body: string }).body).toContain(URL);
  });

  test("an option carrying href — a place, not an answer — is text with the link, never a button", () => {
    const block: Block = {
      shape: "choose",
      text: "Your past conversations:",
      options: [{ value: "c1", label: "Yesterday", href: "https://t.test/agent?c=c1" }],
    };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out.kind).toBe("text");
    expect((out as { body: string }).body).toContain("https://t.test/agent?c=c1");
  });
});

describe("confirm", () => {
  test("becomes two reply buttons: the accept sentence and No", () => {
    const block: Block = { shape: "confirm", text: "Make the trip?", proposal: PROPOSAL };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    expect(out.buttons).toHaveLength(2);
    expect(out.buttons[0].title).toBe("Make the trip");
    expect(out.buttons[1].title).toBe("No");
  });

  test("with no proposal, falls back to its own text as the accept button", () => {
    const block: Block = { shape: "confirm", text: "Take the 4th off the site?" };
    const out = renderForWhatsapp([block], URL, DECLINE);
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    expect(out.buttons[0].title.length).toBeLessThanOrEqual(20);
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
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    const occurrences = out.body.split(sentence).length - 1;
    expect(occurrences).toBe(1);
    expect(out.body).not.toContain("whatsapp-photo.jpg");
    expect(out.body).not.toContain("—");
  });

  test("keeps the model's own prose ahead of the sentence", () => {
    const sentence = "Putting 1 photograph onto the 10th of September.";
    const blocks: Block[] = [
      { shape: "say", text: "Sure, here it is." },
      { shape: "confirm", text: sentence, proposal: PROPOSAL },
    ];
    const out = renderForWhatsapp(blocks, URL, DECLINE);
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    expect(out.body).toBe("Sure, here it is.\n\nPutting 1 photograph onto the 10th of September.");
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
    expect(out.kind).toBe("text");
    expect((out as { body: string }).body).toContain(URL);
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
    expect(out.kind).toBe("buttons");
    if (out.kind !== "buttons") throw new Error("unreachable");
    expect(out.body).toContain("Got it.");
    expect(out.body).toContain("Which trip?");
  });
});
