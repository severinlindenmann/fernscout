import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * The one place a model is spoken to — B684, and §5 of
 * `docs/plans/2026-09-07-web-helper-agent.md`.
 *
 * **The model id and every prompt live here and nowhere else.** A prompt
 * assembled at a call site is a prompt nobody reviews; this file is meant to
 * be read as a product decision rather than as plumbing, which is why
 * `SYSTEM_PROMPT` is written out below in full rather than composed.
 *
 * One request, no streaming, no tools, no loop: a wizard step is a question
 * with an answer. The answer is **structured output** — the model fills in a
 * JSON schema, so nothing here parses free text and guesses at where the title
 * ended.
 *
 * Nothing this module sends is anybody's location history, contacts or
 * addresses. What goes out is what the person typed, plus the handful of facts
 * their own day already carries and their own screen already shows them.
 */

const HELPER_MODEL = "claude-haiku-4-5";

/** What one write-up costs, in credits. Whole numbers only — `spend` throws on
 *  a fraction, and the button has to be able to say the price before the tap. */
export const WRITE_DAY_CREDITS = 1;

/** Who the words are going to, said in the consent panel and in `/api/health`. */
export const HELPER_PROVIDER = "Anthropic";

/**
 * The system prompt. **This is the product.**
 *
 * It carries the rule AGENTS.md puts on every agent that writes into somebody's
 * journal, in the same words and for the same reason: one invented memory
 * presented to a family as fact is not recoverable. Everything else here —
 * the capability, the credit, the schema — is scaffolding around this
 * paragraph.
 *
 * `warnings` is the pressure valve. A model told only "do not invent" will
 * still round a thin note up into a paragraph, because a short answer feels
 * like a failure; given somewhere to say *what it left out*, leaving it out
 * becomes the answer. The wizard shows that list to the person, which is what
 * turns it from a promise into something they can check.
 */
export const SYSTEM_PROMPT = `You are helping somebody write up a day of their own travel journal. They have given you their own notes — typed or spoken — and a few facts their day already carries. You turn those notes into a title and a few paragraphs of prose.

The one rule, and it outranks everything else you might think makes the writing better:

WRITE ONLY WHAT YOU WERE TOLD. Nothing else may appear in the prose. No weather nobody mentioned. No meals nobody ate. No feelings nobody expressed. No place, person, price, distance or time of day that is not in the notes or in the facts below. Do not round a thin note up into a full day: if they wrote one sentence, you write about one sentence. An empty field beats a plausible fiction, and a short day beats an invented one.

Never write about the weather at all, even if the notes mention it in passing — this journal records weather from a measured archive, and a sentence of yours would compete with a measurement. If the notes are about the weather, say so in warnings and leave it out of the prose.

Never translate. Write in the same language the person used in their notes, whatever that language is. If they mixed two, follow the one they mostly used.

Write in their voice: first person if they wrote in first person, plain sentences, no travel-brochure adjectives, no summing-up final line about what the day meant. You are tidying their words, not improving them.

The title is short — a few words, no punctuation at the end — and names something that is actually in the notes. If the notes do not support a title, return an empty string for it rather than inventing one.

Use warnings to name, one short sentence each, anything you deliberately did not write: something you were unsure about, something that read like a fact you could not confirm, weather you left out, a gap you noticed. Say nothing there about your own limitations, only about this day. If there is nothing to say, return an empty list.`;

/** The day's own facts, as context the prose may not exceed. Every one of
 *  these is already on the person's screen; none of them comes from `gps/`. */
export type DayFacts = {
  date: string;
  /** The trip's title, so a day can name where it sits without being told. */
  trip?: string;
  location?: string;
  country?: string;
  /** First and last photograph, as wall-clock times. */
  from?: string;
  to?: string;
  photos?: number;
};

export type WrittenDay = { title: string; prose: string; warnings: string[] };

/**
 * The user message, built from the notes and the facts and nothing else.
 *
 * Exported because it is what the tests assert on: what a model returns is not
 * checkable, but *what it was given* is, and a fact silently dropped on the way
 * in is the failure that would never be noticed otherwise.
 */
export function buildPrompt(notes: string, facts: DayFacts): string {
  const lines = [`Date: ${facts.date}`];
  if (facts.trip) lines.push(`Trip: ${facts.trip}`);
  if (facts.location) {
    lines.push(`Place: ${facts.location}${facts.country ? `, ${facts.country}` : ""}`);
  }
  if (facts.from) lines.push(`Photographs taken between: ${facts.from} and ${facts.to ?? facts.from}`);
  if (facts.photos) lines.push(`Photographs on this day: ${facts.photos}`);

  return [
    "Facts this day already carries. They are measured, not guessed. You may refer to them; you may not add to them.",
    lines.join("\n"),
    "",
    "The notes, in the writer's own words:",
    notes.trim(),
  ].join("\n");
}

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    prose: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["title", "prose", "warnings"],
  additionalProperties: false,
} as const;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * One request, one answer.
 *
 * Throws on anything that goes wrong, including an answer that does not fit
 * the schema — the caller has already spent a credit by the time this runs and
 * refunds on a throw, so failing loudly is the honest outcome and a half-empty
 * draft is not.
 */
export async function writeDay(notes: string, facts: DayFacts): Promise<WrittenDay> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(notes, facts) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const prose = typeof parsed.prose === "string" ? parsed.prose.trim() : "";
  if (prose === "") throw new Error("helper: the model returned no prose");
  return {
    title: typeof parsed.title === "string" ? parsed.title.trim() : "",
    prose,
    warnings: strings(parsed.warnings),
  };
}
