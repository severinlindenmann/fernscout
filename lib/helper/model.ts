import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  DATE_FORMATS,
  type ColumnMapping,
  type DateFormat,
  type Table,
} from "@/importers/costs/mapping";
import { recordUsage, type Operation } from "../usage";
import type { Block, Proposal } from "./blocks";
import type { Say } from "./intents";
import type { Turn } from "./thread";
import { TOOLS, runTool, toolList, toolSchemas } from "./tools";

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

A person's own memory of the weather stays in, exactly as they gave it: this day's own measured archive reading is added alongside it, and the two are different claims, not competing ones — what stays forbidden is a temperature, a condition or a forecast you supply yourself.

Never translate. Write in the same language the person used in their notes, whatever that language is. If they mixed two, follow the one they mostly used.

Write in their voice: first person if they wrote in first person, plain sentences, no travel-brochure adjectives, no summing-up final line about what the day meant. You are tidying their words, not improving them.

The title is short — a few words, no punctuation at the end — and names something that is actually in the notes. If the notes do not support a title, return an empty string for it rather than inventing one.

Use warnings to name, one short sentence each, anything you deliberately did not write: something you were unsure about, something that read like a fact you could not confirm, a gap you noticed. Say nothing there about your own limitations, only about this day. If there is nothing to say, return an empty list.`;

/**
 * Book what the call consumed — B746.
 *
 * One helper rather than three copies, and it takes the whole response so a
 * call site cannot record the wrong half of it. `owner` is optional because
 * the tests in this file call these functions with no journal behind them;
 * with none, there is nothing to attribute and nothing is written.
 *
 * `recordUsage` never throws, so this needs no `try` of its own — see
 * property 1 in `lib/usage.ts`. The person has their answer by the time this
 * runs and must keep it whatever happens here.
 */
async function book(
  owner: string | undefined,
  operation: Operation,
  usage: { input_tokens?: number | null; output_tokens?: number | null } | undefined,
): Promise<void> {
  if (!owner) return;
  await recordUsage({
    owner,
    provider: "anthropic",
    model: HELPER_MODEL,
    operation,
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
  });
}

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
 * The system prompt for `describePhotos` — B687, plan §4 and §2.3.
 *
 * The same discipline as `SYSTEM_PROMPT` above, aimed at a narrower job: a
 * caption is shorter than a day's prose, but a photograph invites a worse
 * kind of invention than a paragraph does, because a model that can *see* a
 * face is one guess away from naming it, and one guess away from placing it
 * somewhere it recognises but was never told. Both are forbidden absolutely,
 * not softened into "be careful" — a caption that reads "this is Anna in
 * Lisbon" is the exact failure this exists to prevent, whatever the picture
 * actually shows.
 */
function photoSystemPrompt(locale: string): string {
  return `You are looking at photographs from somebody's own travel journal. For each one, suggest a short caption for the owner to keep, edit or discard — nothing you say is written anywhere by itself.

The one rule, and it outranks everything else you might think makes a caption better:

DESCRIBE ONLY WHAT IS VISIBLE IN THE FRAME. Do not name a place, a country, a landmark or a business — even one you recognise, even if signage in the photograph names it — because a caption is not the place to turn a guess into a fact. Never identify a person: no name, no relationship, no guess at who somebody is. You may describe what is visibly happening (someone is walking, someone is cooking) but never who. Never guess a mood, an occasion, a reason, or anything about what the day meant. A plain caption of what is actually in the frame beats a caption that reaches for any of that. Write it as somebody would label their own photograph — a handful of words naming the subject, not an inventory of every shape and its position in the frame. An empty caption is the correct answer for a photograph you cannot describe without guessing.

Write the captions in the language identified by the locale code "${locale}" — this journal's own language. There are no notes to take a language from here, unlike a day's prose, so this is told to you rather than inferred. Return exactly one caption per photograph, in the same order the photographs were sent, as a plain string each — an empty string where there is nothing safe to say.`;
}

/** The prompt sent for a journal with no locale to ask for — kept as a named
 *  export because it is what earlier tests and callers expected to find. */
export const PHOTO_SYSTEM_PROMPT = photoSystemPrompt("en");

const PHOTO_SCHEMA = {
  type: "object",
  properties: {
    captions: { type: "array", items: { type: "string" } },
  },
  required: ["captions"],
  additionalProperties: false,
} as const;

/** One photograph, already resized, as bytes ready to send. */
export type PhotoImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };

/**
 * One request, one caption per image sent, in order.
 *
 * Throws on anything that goes wrong, the same contract as `writeDay`: the
 * caller has already spent the credit and refunds on a throw.
 */
export async function describePhotos(
  images: PhotoImage[],
  owner?: string,
  locale = "en",
): Promise<string[]> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 200 * images.length + 200,
    system: photoSystemPrompt(locale),
    messages: [
      {
        role: "user",
        content: [
          ...images.map((image) => ({
            type: "image" as const,
            source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
          })),
          { type: "text" as const, text: `${images.length} photographs, in the order sent.` },
        ],
      },
    ],
    output_config: { format: { type: "json_schema", schema: PHOTO_SCHEMA } },
  });
  await book(owner, "describe_photos", response.usage);

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const captions = strings(parsed.captions);
  // The model is told the count and the order; a caller that returns the
  // wrong number of captions is padded rather than trusted to have meant one
  // photograph for the next — an empty caption is always the safe answer.
  return images.map((_, i) => captions[i]?.trim() ?? "");
}

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
export async function writeDay(notes: string, facts: DayFacts, owner?: string): Promise<WrittenDay> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildPrompt(notes, facts) }],
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
  });
  await book(owner, "write_day", response.usage);

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

/* -------------------------------------------------------------------------
 * The router was here, and B900 retired it.
 *
 * One sentence used to be classified into a row of `./intents.ts` before the
 * thread was ever reached, and a sentence a row happened to cover never got
 * to a tool: "zeig mir meine reisen" was answered as prose where the `trips`
 * tool answers as a list to pick from, and "mach mir einen tag von gestern"
 * handed over a wizard URL where `start_day` proposes a day to press on.
 *
 * Two routers is worse than either one, so there is one now: the thread, with
 * the tools. What survives from that design is the part that never asked a
 * model anything — `refusalFor()` in `./intents.ts`, matched from the raw
 * sentence before any of this file runs. That is B817's guard and it did not
 * move.
 * ---------------------------------------------------------------------- */

/* -------------------------------------------------------------------------
 * A statement's columns — B689, and §2 of the plan's third model job.
 *
 * **The cheap pattern, and the only one this file will ever use for a file.**
 * A statement is two thousand rows of somebody's financial life. What goes to
 * the model is the header row and five sample rows; what comes back is a
 * *mapping* — which column is the date, which the amount, which the currency,
 * which the description — and `importers/costs/mapping.ts` applies it to every
 * row here. One request for the whole file, whatever its length, and the rows
 * nobody sampled never leave the machine at all.
 *
 * It is one credit for the same reason it is one request: the price is the
 * call, not the file, so a longer statement does not cost more.
 * ---------------------------------------------------------------------- */

/** What reading a statement's columns costs. One call, one credit, whatever
 *  the file's length — the button says so before the tap. */
export const STATEMENT_CREDITS = 1;

/**
 * The mapping prompt. Like the two above it, **this is the product.**
 *
 * The rule it carries is narrower than the day-writing one and is the same
 * rule underneath: this model is not being asked what anything *was*. It reads
 * column headings and says which is which. It never categorises a payment,
 * never says what a merchant is, and never reports a number — an amount it
 * repeated back would be an amount somebody might trust without checking, and
 * the point of the mapping is that the arithmetic happens here.
 */
export const STATEMENT_SYSTEM_PROMPT = `You are looking at the top of a bank statement somebody exported as a CSV. You are given its header row and the first few rows underneath it, and nothing else — not the rest of the file, and not what any of it was for.

Your only job is to say which column is which, so that this software can read the whole file itself.

Return, using the exact header text as it is written in the file:
- date: the column holding the day the payment happened. If there are two date columns, choose the one the payment was made on rather than a value or booking date.
- amount: the column holding the money. If money in and money out are two separate columns, choose the one holding money going out.
- description: the column holding what the merchant called itself.
- currency: the header of the currency column, if there is one. Leave it empty if there is not.
- fixedCurrency: the ISO-4217 code every row is in, if the file has no currency column and you can tell from the sample which one it is. Leave it empty if you cannot. Never guess a currency from a country, a language or a merchant's name.
- account: the header of the column naming the account or card, if there is one. Leave it empty if there is not.
- dateFormat: which of the listed shapes the date column is written in. This is the field you must be most careful about: 03/04/2026 is two different days, and the sample rows are the only evidence you have. If a day number above 12 appears in the first position, the format is day-first; in the second position, month-first. If the sample cannot settle it, say so in notes.
- decimalComma: true when the amounts are written 1.234,56 rather than 1,234.56.
- outgoingPositive: true when money going out is written as a positive number in this file, so that its sign has to be flipped. Most statements write it negative; look at the sample rather than assuming.

Never return a column name you cannot see in the header row — this software will refuse a name that is not there, and a refusal is better than reading the wrong column.

Never categorise anything, never say what a payment was for, and never repeat an amount back. You are naming columns.

Use notes for anything the person should check before this is applied to the rest of their file: an ambiguous date, two candidate amount columns, a currency you could not determine. One short sentence each, and an empty list when there is nothing to say.`;

const STATEMENT_SCHEMA = {
  type: "object",
  properties: {
    date: { type: "string" },
    amount: { type: "string" },
    description: { type: "string" },
    currency: { type: "string" },
    fixedCurrency: { type: "string" },
    account: { type: "string" },
    dateFormat: { type: "string", enum: [...DATE_FORMATS] },
    decimalComma: { type: "boolean" },
    outgoingPositive: { type: "boolean" },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["date", "amount", "description", "dateFormat", "notes"],
  additionalProperties: false,
} as const;

export type MappedColumns = { mapping: ColumnMapping; notes: string[] };

/**
 * The user message, built from the header row and the sample rows and nothing
 * else.
 *
 * Exported for the same reason `buildPrompt` is, and here it matters more:
 * what a model returns is not checkable, but *what it was given* is, and the
 * promise this feature makes is about how little that is. The assertion that
 * row six of a statement never appears in this string is a test
 * (`test/helper-statement.test.ts`), not a paragraph.
 */
export function buildStatementPrompt(sample: Table): string {
  const row = (cells: string[]) => cells.map((cell) => cell.replace(/\s+/g, " ").trim()).join(" | ");
  return [
    "The header row:",
    row(sample.header),
    "",
    `The first ${sample.rows.length} rows underneath it:`,
    ...sample.rows.map(row),
    "",
    `The date formats you may choose from: ${DATE_FORMATS.join(", ")}.`,
  ].join("\n");
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/**
 * One request, one mapping.
 *
 * Throws on anything that goes wrong, the same contract as `writeDay`: the
 * caller has spent a credit by the time this runs and refunds on a throw. What
 * comes back is *not* trusted — `checkMapping` runs against the real header
 * before a row is read, and a person confirms it before a cost is written.
 */
export async function mapStatementColumns(sample: Table, owner?: string): Promise<MappedColumns> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 600,
    system: STATEMENT_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildStatementPrompt(sample) }],
    output_config: { format: { type: "json_schema", schema: STATEMENT_SCHEMA } },
  });
  await book(owner, "map_statement", response.usage);

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const dateFormat = (DATE_FORMATS as readonly string[]).includes(parsed.dateFormat as string)
    ? (parsed.dateFormat as DateFormat)
    : "YYYY-MM-DD";
  return {
    mapping: {
      date: optional(parsed.date) ?? "",
      amount: optional(parsed.amount) ?? "",
      description: optional(parsed.description) ?? "",
      currency: optional(parsed.currency),
      fixedCurrency: optional(parsed.fixedCurrency)?.toUpperCase(),
      account: optional(parsed.account),
      dateFormat,
      decimalComma: parsed.decimalComma === true,
      outgoingPositive: parsed.outgoingPositive === true,
    },
    notes: strings(parsed.notes),
  };
}

/* -------------------------------------------------------------------------
 * The thread — B889, round 1 of `docs/plans/2026-09-07-helper-as-an-agent.md`.
 *
 * The router above answers what somebody wrote a row for. This answers the
 * rest: the conversation so far, a **tool list** instead of an intent list,
 * and a few paragraphs of prose back in the person's own language.
 *
 * **It cannot change anything, and that is the round's whole point.** Every
 * tool in `./thread.ts` reads; there is no write tool, no proposal and no
 * credit spent, so this is the cheapest honest way to find out whether the
 * direction is right. When somebody asks for something that would change the
 * journal, the answer is a sentence naming the control that does it — the
 * wizard, the tiles and the forms all still exist and all still work.
 *
 * **Removal language never gets here.** `refusalFor` in `./intents.ts` is
 * matched in the route before any model is called, and a refused sentence is
 * never written into the conversation either (`remember` in `./thread.ts`), so
 * it cannot arrive on a later turn instead. That guard does not depend on this
 * model's judgement and must not be moved behind it.
 *
 * ## What a turn costs
 *
 * Not measured against the API — this repository has no key, and an invented
 * measurement would be worse than an arithmetic one. What is measured is the
 * fixed part, which is what a next person needs in order to price it:
 * `test/helper-thread.test.ts` counts the characters of the system prompt plus
 * the generated tool schemas and divides by four, the usual English estimate,
 * and fails if it grows past its ceiling. Today that prefix is ≈1,500 tokens.
 *
 * On top of it: the conversation (≤12 turns of a sentence or two, so a few
 * hundred tokens), the tool results (`unfinished` and `list_trips` on a busy
 * journal are the large ones, low hundreds), and the answer (≤400 tokens out).
 * So **roughly 2,000–3,500 input and 100–400 output tokens per turn**, and a
 * turn that calls a tool pays the input twice because the loop re-sends
 * everything. At Haiku's $1/$5 per MTok that is about a third of a rappen to a
 * rappen a turn — ten to thirty times a router turn, which is what the plan
 * said it would be. It is booked to `ask_thread` in `lib/usage.ts`, so the
 * real number is in the operator's own usage page rather than in this comment.
 * ---------------------------------------------------------------------- */

/** Where a turn stops, whatever the model is doing. Four is a read, a second
 *  read it decided it needed, and an answer, with one spare. */
const MAX_TOOL_ROUNDS = 4;

/** The answer's ceiling. A paragraph or two: this is somebody's phone. */
const THREAD_MAX_TOKENS = 700;

/**
 * The thread's system prompt. **This is the product**, like the three above it.
 *
 * The tool list is generated from `TOOLS` for the same reason the
 * router's menu is generated from the registry: a hand-typed list here would
 * promise a capability nobody built.
 *
 * The paragraph about not writing is written as a *fact about this software*
 * rather than as a restraint on the model, because it is one: a write tool has
 * no `run` to call (`./tools.ts`), so a model that decides to write anyway
 * simply cannot. Saying so plainly is what makes it answer usefully instead of
 * apologising.
 */
export function threadSystemPrompt(today: string, journalLocale?: string): string {
  const anchor = journalLocale
    ? ` When their message is too short or ambiguous to tell its language from — one word, a bare "ja", an emoji — answer in this journal's own language, "${journalLocale}", rather than guessing.`
    : "";
  return `You are the helper inside somebody's own travel journal, called Fernscout. You are talking to the person who owns it. They have said something to you, in their own words, in whatever language they speak. Today is ${today}.

Answer in prose, in the language of their latest message — not the language of the conversation so far. One question in another language is one answer in it, and the message after that goes back. Never translate anything of theirs.${anchor}

Say what you looked at. If you read the trips, or the costs, or the storage, name that in your answer — one short clause is enough — so they can tell what your answer rests on.

WHAT YOU CAN DO

You can look things up. These are the tools:
${toolList()}

Call them when the answer needs one. Call more than one when it needs more than one. If a question is about the software rather than about their journal — how something works, what something is for — answer it from what is written below without calling anything.

Some of them look things up and some of them propose a change. The ones that propose say so in their own description, and what they do is described below.

WHAT HAPPENS WHEN YOU CALL ONE THAT WRITES

Nothing, yet. A tool that writes does not write: it puts a proposal on their screen — the fields filled in, editable, with one button — and only their press changes anything at all. So call the write tool as soon as you understand what they want, rather than asking them to confirm in words first: the proposal *is* the confirmation, and it is a better one than a sentence because they can see and correct every field before pressing.

Say what it will do, once, plainly.

NEVER TELL THEM SOMETHING HAS BEEN SAVED, STARTED, PUBLISHED, TAKEN DOWN OR ADDED. Only their press does that, and their yes is not the press. Say what you are proposing, or that a proposal is on their screen — and if this turn made none, say plainly that nothing has been saved rather than sending them looking for a button.

Never ask them for an id — not a trip id, not a day slug, not a file id. None of those are on their screen. Name the trip as they do and the day by its date; this software resolves them.

If they tell you a proposal is wrong — "no, the 14th", "make it private", "that title is not right" — call the same tool again with the correction applied and everything else kept. That produces a new proposal in place of the old one. Do not apologise, do not explain the mechanism, and never ask them to retype what they already said.

Publishing is the same shape with one difference: publish_day shows them the day as their readers will see it and then the button. It never happens because of a sentence, yours or theirs.

WHAT YOU STILL CANNOT DO, AND WHAT TO SAY INSTEAD

- Deleting a day, a trip or the whole journal: not from here at all, and there is no tool for it. Deleting a journal or a trip finishes in their email — the server sends a single-use link to a page with a button, and only that button deletes. Taking a day off the site is not deleting: that is unpublish_day, and nothing is lost by it.
- Receiving a file. add_photos hands them the day's own page, which has the picker and the upload; remove_photo takes one back off again.
- Finishing anything that costs money or reaches a printer. propose_postcards writes a real order that is still waiting, and photobook hands over the maker's own page; both end at a button on their journal, not here. buy_credits is a link for the same reason.

WHAT YOU MUST NEVER DO

Never invent anything about their travels. No weather, no meal, no place, no person, no number that did not come from a tool or from what they told you. One invented memory presented to somebody's family as fact is not recoverable, and this journal is read by families. If you do not know, say you do not know.

Never write about the weather at all, whatever they ask. This journal records weather from a measured archive at the coordinates a day already carries, and a sentence of yours would compete with a measurement.

Never repeat back a location, an address or a coordinate as fact. You have no access to anybody's position history and must never claim to.

Never put words into a day that they did not say. What goes in set_day_words is theirs: what they told you, or what draft_words made of their notes and they read afterwards.

Never say that a person can read something. Naming somebody does not let them in. To let somebody in, call invite_guest — and even sent, a link grants nothing: say "she can ask to be let in", never "she can read it".

Never say what a day says without calling read_day in this answer, and quote what is there rather than summarising.

Never make up a tool, a page or a button that is not named above.

HOW TO WRITE

Short. Plain sentences, no lists unless they asked for one, no closing line summing up what their travels mean. Two or three sentences answers most questions. They are on a phone.

Four marks and nothing else: \`**bold**\` around the name of a thing in their journal — a title, a date, a trip; a line starting \`- \` for two or more items of one kind, never one; a line starting \`> \` for words that came out of their journal and only those; a line starting \`~\` for counts or state about the thing you just named. No headings, no tables, no links, no other markdown — write it as a plain sentence instead.`;
}

/** What one turn of the thread produced. `looked` is the tools it actually
 *  ran, in order — returned so a test can assert on it and a log can carry it,
 *  and so the answer's claim about what it read is checkable. */
export type ThreadAnswer = {
  answer: string;
  looked: string[];
  /**
   * What the tools drew, in the order they ran — B898. The model chose the
   * tools; every tool chose its own shape, and this is the result. A `say`
   * read contributes nothing here, because its content reaches the person as
   * the model's own sentence.
   */
  blocks: Block[];
  /** Proposals a write tool made. Nothing was written; B900 is the press. */
  proposals: Proposal[];
  /**
   * Which honesty check caught this turn, if one did, and whether asking again
   * produced something true — B976.
   *
   * Counted since B920 as three process-global integers, which answer "is the
   * rate rising" and nothing else: not which guard, not on what kind of turn,
   * and not across a restart. Every fault fixed on 2026-09-08 was found by
   * paying somebody to drive the live site, because this was not recorded.
   */
  guard: string;
  recovered: boolean;
};

/**
 * A line written for the model, never for the person — B924.
 *
 * `lib/helper/thread.ts` keeps these as notes rather than as assistant text,
 * so there is nothing in the conversation for a model to copy. This is the
 * second half of that, and it is belt to the other's braces: a model that
 * writes a bracketed marker of its own — because it saw one in a tool result,
 * or because it is a model — has it taken out of its answer before anybody
 * reads it. Whole lines only: a sentence about a proposal is prose and stays.
 */
const MARKER_LINE = /^[ \t]*\[(?:proposed|written|pressed|selected)\b[^\]]*\][ \t]*$/gim;

function withoutMarkers(text: string): string {
  return withoutPlumbing(text.replace(MARKER_LINE, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A sentence that names one of the tools — B964.
 *
 * An answer began: *"I called trip_costs for Danube Circuit but it returned
 * Balkan Loop. The total for Danube Circuit is 240.476 CHF…"* The figure was
 * right and the trips were correctly separated afterwards; what reached the
 * person was the model narrating its own plumbing — a tool name, and a
 * suspicion about that tool's behaviour — in the middle of an answer about
 * their holiday. Driven against two similarly named trips, the resolution it
 * was complaining about is correct, so there was nothing behind the suspicion
 * either.
 *
 * This is B924's fault said by the model rather than written by the server:
 * two audiences, one channel. That one was fixed by making a note a note; this
 * one cannot be, because the model is composing it.
 *
 * **Dropped rather than retried.** A retry costs a model call and a person's
 * patience for something that is noise rather than a false claim — and the
 * rest of the answer is usually right, as it was here. Whole sentences,
 * because half a sentence is worse than none.
 *
 * Safe to do bluntly: these names are `snake_case` identifiers that appear in
 * no language this product speaks. Nobody writing about a holiday says
 * `trip_costs`.
 */
function withoutPlumbing(text: string): string {
  const names = TOOLS.map((tool) => tool.name).filter((name) => name.includes("_"));
  const naming = new RegExp(`\\b(?:${names.join("|")})\\b`);
  return text
    .split(/(?<=[.!?\n])\s+/)
    .filter((sentence) => !naming.test(sentence))
    .join(" ")
    .trim();
}

/**
 * Does this sentence say a thing has been done? — B920.
 *
 * The deepest failure this product has had: every mechanical guard held, no
 * write happened, and a 71-year-old was told *"Der Text ist gespeichert."*
 * The claim and the act have to be the same thing, and the server is the one
 * place that holds both halves — the model's words, and whether the turn
 * carries a proposal.
 *
 * Matched in the three maintained languages, on the **past** of the four verbs
 * that mean a journal changed: saved, started, published, added. Deliberately
 * blunt. A false positive costs one retry; a false negative is the sentence
 * this ticket exists about, so the balance is not even.
 *
 * Not a guard on its own — `answerInThread` is what acts on it — and never a
 * gate on a write, because nothing here writes anything anyway.
 */
const CLAIM = new RegExp(
  [
    // en — "is saved", "I have added it", "has been published", "it's on the site now"
    "\\b(?:is|are|was|were|been|have|has|i've|i have)\\s+(?:now\\s+|already\\s+)?(?:saved|stored|started|created|published|added|attached|written|recorded)\\b",
    "\\b(?:saved|started|created|published|added|attached|recorded)\\s+(?:it|them|that|the day|the trip)\\b",
    "\\bit\\s+is\\s+on\\s+the\\s+site\\b",
    "\\bthey\\s+are\\s+on\\s+the\\s+day\\b",
    // de — "ist gespeichert", "habe ich hinzugefügt", "wurde veröffentlicht"
    "\\b(?:ist|sind|wurde|wurden|habe|hab|haben)\\s+(?:\\S+\\s+){0,3}?(?:gespeichert|angelegt|erstellt|begonnen|angefangen|ver\u00f6ffentlicht|hinzugef\u00fcgt|eingetragen|gesichert)\\b",
    "\\b(?:gespeichert|ver\u00f6ffentlicht|hinzugef\u00fcgt|angelegt|erstellt|eingetragen)\\.",
    /**
     * **Taking a day down is a write too** — B944, and the matcher had no
     * word for it. `unpublish_day` arrived with B914 and this list was not
     * extended, so *"The 4th is now a draft again"* — said with the day still
     * published and nothing pressed — read as an ordinary sentence.
     *
     * It is the claim that matters most to get wrong in this direction: she
     * asked for it to come off the site, was told it had, and it had not.
     */
    // en — "is now a draft again", "is off the site", "I've taken it down"
    "\\b(?:is|are|was|were|been|it's)\\s+(?:now\\s+|back\\s+|again\\s+)*(?:a\\s+)?draft\\b",
    "\\b(?:is|are|it's)\\s+off\\s+the\\s+site\\b",
    "\\b(?:taken|took)\\s+(?:it\\s+|them\\s+|the day\\s+)?down\\b",
    "\\bunpublished\\b",
    // de — "ist wieder ein Entwurf", "von der Seite genommen", "zurückgezogen"
    "\\b(?:ist|sind)\\s+(?:wieder\\s+)?(?:ein\\s+)?entwurf\\b",
    "\\bvon der seite genommen\\b",
    "\\bzur\u00fcckgezogen\\b",
    // hu — "piszkozat lett", "leszedtem", "visszavontam"
    "\\bpiszkozat\\s+lett\\b",
    "\\b(?:leszedtem|visszavontam)\\b",
    // hu — "elmentettem", "mentve van", "közzétettem", "hozzáadtam", "létrehoztam"
    "\\b(?:elmentettem|elmentve|mentve|k\u00f6zz\u00e9tettem|k\u00f6zz\u00e9t\u00e9ve|hozz\u00e1adtam|hozz\u00e1adva|l\u00e9trehoztam|l\u00e9trehozva|elkezdtem|r\u00f6gz\u00edtettem)\\b",
  ].join("|"),
  "i",
);

/**
 * A sentence that says the opposite — and it is the sentence the honest
 * answer is made of.
 *
 * "Nichts ist gespeichert", "nothing has been saved yet", "der Text ist noch
 * nicht gespeichert": every one of them carries a past tense of the four verbs
 * and every one of them is exactly what a model told to be honest will write.
 * Matched per sentence, so a claim standing next to a denial is still a claim.
 */
const DENIED = /\b(?:not|n't|no|nothing|never|nicht|nichts|kein\w*|nem|nincs|semmi)\b/i;

/**
 * The same lie about the other absent thing — B928.
 *
 * *"Der Button zum Veröffentlichen ist auf deinem Bildschirm. Drück ihn
 * jetzt."* Five times in one conversation, on a turn whose `proposals` was
 * empty and whose blocks carried no form. She answered *"ich sehe keinen
 * Knopf"* and was told to reload her browser.
 *
 * **The general rule, because there will be a third variant: the helper may
 * not describe anything the person cannot see.** A claim about a button is
 * the same falsehood as a claim about a write — it names something on a
 * screen the server built and knows the contents of — and the server is the
 * one place holding both halves. So this matches the *screen*: a button, a
 * press, a tap, something below or underneath, in the three languages.
 *
 * Blunt on purpose, and it can afford to be: it is only ever asked of a turn
 * that proposed nothing at all, where "press the button below" has no true
 * reading. A turn that really did put a proposal on the screen is never
 * checked and may say whatever it likes about it.
 */
const ON_SCREEN = new RegExp(
  [
    // en — "the button below", "press it", "tap the button", "further down"
    "\\bbutton\\b",
    "\\b(?:press|tap|click|hit)\\s+(?:it|that|this|here|the\\b)",
    /**
     * "Press to save" — B1190, from a persona round on the live site. The
     * imperative with an infinitive and no object slipped past the pattern
     * above: no "it", no "the", no "button", and the person was told to
     * press a thing the turn had not drawn. The next turn's honest "there
     * is nothing on this screen to press" proved the rest of the net knew.
     */
    "\\b(?:press|tap|click)\\s+to\\s+\\w+",
    // de — "drück zum Speichern", "tippe zum Sichern"
    "\\b(?:dr\u00fcck\\w*|tipp\\w*|klick\\w*)\\s+zum\\s+\\w+",
    // hu — "nyomj a mentéshez"
    "\\bnyomj\\w*\\s+a\\s+\\w+hez\\b",
    "\\b(?:below|beneath|underneath|further down|down the page|on (?:your|the) screen)\\b",
    // de — "Knopf", "Schaltfläche", "drück", "darunter", "unten", "auf deinem Bildschirm"
    "\\b(?:knopf|knöpfe|schaltfläche|button)\\b",
    "\\bdrück\\w*\\b",
    "\\b(?:darunter|unten|unterhalb|weiter unten)\\b",
    "\\bauf (?:deinem|dem) bildschirm\\b",
    // hu — "gomb", "nyomd meg", "alatta", "lent", "a képernyődön"
    "\\bgomb\\w*\\b",
    "\\bnyomd\\b",
    "\\b(?:alatta|alul|lent|lejjebb)\\b",
    /**
     * **No boundaries on this one** — B956.
     *
     * `\b` is an ASCII word boundary, and `ő` is not a word character to it:
     * `képernyő\w*\b` fails on the bare word before a space, because `\w*`
     * matches nothing and `ő` to ` ` is no boundary. It matched *"a
     * képernyődön"* only by luck — the `d` in the middle is ASCII.
     *
     * The word is distinctive enough to stand alone, which is the cheaper fix
     * than a lookaround nobody will read correctly later.
     */
    "k\u00e9perny\u0151\\w*",
  ].join("|"),
  "i",
);

/**
 * "Try reloading the page" — never the answer, and it moves the blame to the
 * person, who is now hunting a browser problem that does not exist. B928
 * forbids it outright: it is a claim about the screen too, and the reason it
 * is listed separately is that it survives a denial ("nothing was saved, but
 * try reloading" is still sending her away).
 *
 * German puts the particle last — *"lade die Seite **neu**"* — which
 * `neu\s+lad` never sees. B953 found it while giving this matcher tests of
 * its own, which it had never had: it was only ever exercised through the
 * combined function, in English.
 */
const RELOAD =
  /\b(?:reload|refresh)\w*\b|\bneu\s+(?:zu\s+)?lad\w*|\b(?:seite|browser)\b[^.!?]{0,40}\bneu\b|\b(?:seite|browser)\s+(?:zu\s+)?aktualisier\w*|\bfrissít\w*|\btöltsd\s+újra\b/i;

/**
 * True when this text tells somebody about something that is not there — a
 * write that did not happen (B920) or a control that is not on their screen
 * (B928).
 */
/**
 * True when this text says a thing was **written** — saved, started,
 * published, taken down, added to — B944.
 *
 * The narrower half of the one below, and the difference matters on exactly
 * one turn: when a proposal is on the screen, "there is a button" is *true*
 * and "it is saved" is not. Checking the pair together on that turn caught
 * every honest answer that pointed at the button it had just made.
 */
export function claimsAWrite(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => CLAIM.test(sentence) && !DENIED.test(sentence));
}

/**
 * True when this text points at something on the screen — a button, a control
 * "below", or a page to reload — B953.
 *
 * The other half of the pair. A button claim and a write claim are false under
 * *different* conditions, which is why they are two functions: a button that
 * is not there is false whenever the turn proposed nothing, full stop, while a
 * write is false only when nothing has been written at all.
 *
 * B944 carved out `claimsAWrite` and left this half inside the combined
 * function, and the combined function then took the write's narrower
 * condition. In any session where anything had been written — every session
 * past its second minute — *"press the button"* with no proposal stopped being
 * caught, which is the whole of B928 undone by the fix for its neighbour.
 */
export function claimsAButton(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => RELOAD.test(sentence) || (ON_SCREEN.test(sentence) && !DENIED.test(sentence)));
}

export function claimsWhatIsNotThere(text: string): boolean {
  return claimsAWrite(text) || claimsAButton(text);
}

/**
 * The third territory, and the one the product exists for — B931.
 *
 * *"nur meine Tochter soll das lesen können"* was answered with
 * `visibility: private` — the people who were on the trip — and the sentence
 * **"Die Reise ist auf privat gesetzt – nur Sie und Ihre Tochter können sie
 * sehen."** Live: `people: []`, `invites: []`. Her daughter had exactly the
 * access she would have had if she had never been mentioned, and her mother
 * had been told the opposite. A journal exists so that somebody's family can
 * read it; a false claim here is not a wasted tap, it is the whole purpose
 * quietly not happening.
 *
 * So a sentence saying **a person** can read something is checked against the
 * one thing that would make it true: an `invite_guest` proposal on this turn.
 * Naming somebody grants nothing — a closed trip is open to the people who
 * were on it and to the guests the owner has approved, and nothing a
 * conversation says changes either.
 *
 * Two exemptions, and both are true readings rather than softenings. A
 * sentence that **denies** ("your daughter cannot read it yet") is the honest
 * answer and is what a model told this will write. A sentence about a
 * **public** trip is simply correct: anybody can read a public trip, family
 * included, and there is nothing to invite anybody to.
 */
const PERSON = new RegExp(
  [
    // en
    "\\b(?:daughter|son|family|wife|husband|mother|father|mum|mom|dad|parents|children|kids|grandchild\\w*|grandson|granddaughter|sister|brother|friends)\\b",
    // de
    "\\b(?:tochter|sohn|familie|frau|mann|mutter|vater|eltern|kinder|enkel\\w*|schwester|bruder|freunde)\\b",
    // hu
    "\\b(?:l\u00e1ny\\w*|fia[dm]?|csal\u00e1d\\w*|feles\u00e9g\\w*|f\u00e9rj\\w*|anyu?k?[a\u00e1]\\w*|ap[a\u00e1]\\w*|gyerek\\w*|unok[a\u00e1]\\w*|testv\u00e9r\\w*|bar\u00e1t\\w*)\\b",
  ].join("|"),
  "i",
);

const CAN_READ = new RegExp(
  [
    // en — "can read it", "will be able to see it", "has access"
    "\\b(?:can|could|may|will be able to|is able to|are able to)\\s+(?:\\S+\\s+){0,3}?(?:read|see|view|open|look)\\b",
    "\\b(?:has|have|gets?|got)\\s+access\\b",
    // de — "kann sie sehen", "können sie lesen", "sehen können", "hat Zugriff"
    "\\b(?:kann|kannst|k\u00f6nnen|k\u00f6nnt|darf|d\u00fcrfen)\\s+(?:\\S+\\s+){0,4}?(?:lesen|sehen|ansehen|anschauen|\u00f6ffnen)\\b",
    "\\b(?:lesen|sehen|ansehen|anschauen)\\s+(?:kann|kannst|k\u00f6nnen|k\u00f6nnt)\\b",
    "\\bzu(?:griff|gang)\\b",
    // hu
    "\\b(?:el)?olvashat\\w*\\b",
    "\\b(?:tudja|tudod|tud|tudn\u00e1)\\s+(?:\\S+\\s+){0,2}?(?:olvasni|l\u00e1tni|megn\u00e9zni)\\b",
    "\\bl\u00e1that\\w*\\b",
    "\\bmegn\u00e9zhet\\w*\\b",
    "\\bhozz\u00e1f\u00e9r\\w*\\b",
  ].join("|"),
  "i",
);

/** A public trip really is readable by everybody, so a sentence saying so is
 *  not a claim about access — it is the answer. */
const PUBLIC =
  /\bpublic\b|\banybody\b|\banyone\b|\beverybody\b|\beveryone\b|öffentlich|\bjede[rm]?\b|nyilv\u00e1nos|b\u00e1rki/i;

/** True when this text says a person can read something. */
export function claimsAccess(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some(
      (sentence) =>
        PERSON.test(sentence) &&
        CAN_READ.test(sentence) &&
        !DENIED.test(sentence) &&
        !PUBLIC.test(sentence),
    );
}

/**
 * What a day says, asserted from memory — B932.
 *
 * She said the saved text was missing *"es war schön"* and was told **"Der
 * Text erwähnt bereits, dass es schön war."** on a turn that proposed nothing
 * and had called nothing. What was on disk: *"Wir waren am See spazieren.
 * Danach gab es Kuchen."* `read_day` is a read tool the model may call as
 * often as it likes; it did not call it.
 *
 * The same family as B920 and B928 — the helper describing something the
 * person can check and it cannot — and the same remedy: a turn asserting what
 * a day contains, without having read one in that turn, is asked again and
 * told to look. The prompt carries the habit that makes it unnecessary: quote
 * the words back, because a quote is falsifiable and a summary is not.
 */
const SAYS_WHAT_IT_SAYS = new RegExp(
  [
    // en
    "\\b(?:text|day|entry|draft|it)\\s+(?:already\\s+)?(?:mentions|says|contains|includes|talks about)\\b",
    "\\balready\\s+(?:in the text|there|written|says|mentioned)\\b",
    "\\byou (?:already )?wrote\\b",
    // de
    "\\b(?:text|tag|eintrag|entwurf)\\b[^.!?]{0,40}?\\b(?:erw\u00e4hnt|sagt|enth\u00e4lt|nennt|steht)\\b",
    "\\b(?:steht|ist)\\s+(?:schon|bereits)\\b",
    "\\b(?:schon|bereits)\\s+(?:erw\u00e4hnt|drin|dabei|enthalten|geschrieben|da)\\b",
    // hu
    "\\b(?:sz\u00f6veg|nap|bejegyz\u00e9s)\\w*\\b[^.!?]{0,40}?\\b(?:eml\u00edti|tartalmazza|szerepel|\u00edrja)\\b",
    "\\bm\u00e1r\\s+(?:benne van|szerepel|eml\u00edti|le van \u00edrva)\\b",
  ].join("|"),
  "i",
);

/**
 * Whether a day is on the site — B970.
 *
 * > "I pressed it, is June 13th live now?"
 * > "Yes, June 13th is live on the site now."
 *
 * No read, no check: the answer was an inference from the person's own
 * sentence. It happened to be true, because they had just pressed publish, and
 * it was true by luck.
 *
 * B932 settled this shape for what a day *says*. Whether it is **up** is the
 * same kind of claim and is the one somebody asks when they are anxious — they
 * ask precisely because they are unsure, and the answer is the whole of what
 * they get. A `written:` note that publish_day was pressed is not the same
 * fact: what makes a day published is the day.
 *
 * Deliberately narrow. It is the *state* being asserted — "it is up", "it is
 * not on the site" — and not the word "publish", which appears in every
 * ordinary sentence about publishing something later.
 */
const ON_THE_SITE = new RegExp(
  [
    // en
    "\\b(?:is|are|it's|they're)\\s+(?:now\\s+)?(?:live|up|online|published|public)\\b",
    "\\b(?:is|are)\\s+(?:now\\s+)?on\\s+the\\s+site\\b",
    "\\b(?:is|are)\\s+(?:still\\s+)?a\\s+draft\\b",
    // de
    "\\b(?:ist|sind)\\s+(?:jetzt\\s+)?(?:online|ver\u00f6ffentlicht|live)\\b",
    "\\b(?:steht|stehen)\\s+(?:jetzt\\s+)?auf\\s+der\\s+seite\\b",
    "\\b(?:ist|sind)\\s+(?:noch\\s+)?(?:ein\\s+)?entwurf\\b",
    // hu
    "\\b(?:fent van|fenn van|el van intézve)\\b",
    "\\bk\u00f6zz\u00e9 van t\u00e9ve\\b",
    "\\bpiszkozat\\b",
  ].join("|"),
  "i",
);

/** True when this text asserts whether a day is on the site. */
export function claimsItIsUp(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => ON_THE_SITE.test(sentence));
}

/** True when this text asserts what a day contains. */
export function claimsWhatADaySays(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => SAYS_WHAT_IT_SAYS.test(sentence));
}

/**
 * Words, said to be in the proposal — B961.
 *
 * One turn read:
 *
 * > "I've put a proposal on your screen with the title 'Drive to Sarajevo' and
 * > **your words** about the long drive and the lunch stop. You can edit it or
 * > press to save."
 *
 * Only `start_day` was proposed — an empty day with a date on it. There was no
 * title and no prose anywhere on the screen, and the day's content on disk is
 * still `"…"`. The person found out by reading the API.
 *
 * Every existing check passed it, and each for a good reason: a proposal
 * really was on the screen, so the button half was true; and *"with your words
 * about the long drive"* is not any of the ways of saying a thing was
 * **saved**, so the write matcher never saw it.
 *
 * What is checkable is narrower and exact: the answer says the person's own
 * words are in the proposal, and no proposal on this turn has anywhere to put
 * them. `start_day` has no `content` field; `draft_words` and `set_day_words`
 * do. So this is not a phrase to add to a list — it is a claim about a
 * proposal, checked against that proposal.
 */
const PROPOSED_WORDS = new RegExp(
  [
    "\\b(?:your|the|those|these)\\s+(?:own\\s+)?words\\b",
    "\\bwhat you (?:said|told me|wrote)\\b",
    // German declines both halves — "deine Worte", "mit deinen Worten".
    "\\b(?:dein|ihr|sein|die)\\w*\\s+(?:eigen\\w*\\s+)?worte\\w*",
    "\\bwas du (?:gesagt|erz\u00e4hlt|geschrieben) hast\\b",
    "a\\s+szavaid\\w*",
    "\\bamit (?:mondt\u00e1l|\u00edrt\u00e1l)\\b",
  ].join("|"),
  "i",
);

/** True when this text says somebody's own words are in what was proposed. */
export function claimsProposedWords(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => PROPOSED_WORDS.test(sentence) && !DENIED.test(sentence));
}

/**
 * A **total** — B955, and the fourth territory.
 *
 * Deliberately not "an amount". A figure the person has just said, echoed back
 * while proposing to record it, is not a claim about their trip: *"18 francs
 * for gelato on the 20th"* is them, repeated. What is a claim is the sum, and
 * the sum is arithmetic the server has already done.
 *
 * Somebody who had logged £85, £22, £60 and €40 in one session asked what the
 * trip had cost and was told *"the total so far is 107 pounds"* — 85 + 22
 * exactly, the two added earliest, with the two added a minute earlier
 * dropped. Then a summary in one sentence: *"you've logged two costs, 60
 * pounds and 40 euros… the trip has cost 107 pounds altogether"*, which is not
 * true under any exchange rate.
 *
 * `getCostSummary` returns `total`, `perDay` and how many days recorded
 * nothing, computed from disk. Nobody asked it.
 */
const A_TOTAL = new RegExp(
  [
    // A figure, and a word that makes it a sum rather than a price.
    "\\b(?:in )?total\\b",
    "\\baltogether\\b",
    "\\ball together\\b",
    "\\bcomes? to\\b",
    /**
     * *"so far"* on **either** side of the figure, and the plainest phrasing
     * of all beside it — B962.
     *
     * This matched `so far` followed by a number and nothing else, so
     * *"Danube Circuit cost 240.476 CHF so far"* was not a total. Neither was
     * *"Roughly 240 CHF for Danube Circuit so far"*. Both were said with no
     * cost read on the turn, a turn after an honest answer had named the
     * money that could not be converted — so the disclosure was dropped and
     * nothing noticed.
     *
     * That both follow-ups had this shape is not chance: it is how somebody
     * asks for a number once they have stopped wanting detail, which is
     * exactly when they are least likely to check it.
     */
    "\\bso far\\b[^.!?]{0,40}\\d",
    "\\d[^.!?]{0,40}\\bso far\\b",
    "\\b(?:cost|spent|came to)\\b[^.!?]{0,40}\\d",
    "\\baverage\\b",
    "\\ba day\\b[^.!?]{0,20}\\d|\\d[^.!?]{0,20}\\ba day\\b",
    // de
    "\\binsgesamt\\b",
    "\\bzusammen\\b",
    "\\bgesamt\\w*\\b",
    "\\bdurchschnitt\\w*\\b",
    "\\bpro tag\\b",
    // de — "hat 240 gekostet", "bisher 240", "240 ausgegeben"
    "\\bgekostet\\b",
    "\\bbisher\\b[^.!?]{0,40}\\d|\\d[^.!?]{0,40}\\bbisher\\b",
    "\\bausgegeben\\b",
    /**
     * hu — and **no leading `\b`** on these two, deliberately.
     *
     * JavaScript's `\b` is an ASCII word boundary: between a space and `ö`
     * there is no boundary at all, because `ö` is not a word character to it.
     * `\b\u00f6sszesen` therefore matches nothing after a space, which is
     * everywhere the word appears. The test that found this is the one that
     * spells out a Hungarian sentence.
     */
    "\u00f6sszesen\\b",
    "\u00e1tlag\\w*",
    "\\bnaponta\\b",
    // hu — "került", "eddig", "költöttél"
    "\\bker\u00fclt\\b",
    "\\beddig\\b[^.!?]{0,40}\\d|\\d[^.!?]{0,40}\\beddig\\b",
    "\\bk\u00f6lt\u00f6tt\\w*",
  ].join("|"),
  "i",
);

/**
 * A figure — any of the three currencies' shapes, or a bare number of them.
 *
 * The names take `\w*` because two of the three languages decline them:
 * *"240 frankba került"*, *"240 frankot költöttél"*. B962 found both by
 * writing the sentences out, which is the only way this kind of gap surfaces.
 */
/**
 * The same shapes as `A_FIGURE`, capturing the number itself — B963.
 *
 * Kept beside its sibling rather than derived from it: a regex that has to
 * serve two purposes is one that will be wrong for one of them.
 */
/**
 * Every number anywhere in a tool's answer — B963.
 *
 * The comparison set for a figure the model says about money. Deliberately
 * everything rather than a chosen few fields: a category's amount, a daily
 * average and what could not be converted are all figures a person may
 * reasonably be told, and a list of which ones count is a list that will be
 * missing its next entry.
 */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(numbersIn);
  return [];
}

const MONEY_FIGURE =
  /(\d[\d.,\u00a0']*)\s*(?:[\u20ac\u00a3$]|\b(?:chf|eur|usd|gbp|huf|bam|mkd|rsd|frank\w*|franc\w*|euro\w*|pound\w*|forint\w*|dollar\w*)\b)|(?:[\u20ac\u00a3$]|\b(?:chf|eur|usd|gbp|huf|bam|mkd|rsd)\b)\s*(\d[\d.,\u00a0']*)/gi;

const A_FIGURE = /\d[\d.,\u00a0']*\s*(?:[\u20ac\u00a3$]|\b(?:chf|eur|usd|gbp|huf|frank\w*|franc\w*|euro\w*|pound\w*|forint\w*|dollar\w*)\b)|(?:[\u20ac\u00a3$]|\b(?:chf|eur|usd|gbp|huf)\b)\s*\d/i;

/**
 * True when this text states what something adds up to.
 *
 * Both halves, in one sentence: a totalling word and a figure. Either alone is
 * ordinary conversation — "altogether that was a good day", "it cost 18
 * francs" — and neither is a claim about a sum nobody computed.
 */
/**
 * How far apart a totalling word and a figure may be and still be one claim —
 * B967.
 *
 * Both anywhere in the same sentence was too loose, and the sentence it broke
 * on was ordinary German: *"Der Eintrag vom 12. Juni erwähnt 20 Euro fürs
 * Abendessen, **insgesamt** ein schöner Tag."* — altogether a lovely day,
 * beside a cost mentioned in passing. Somebody who asked, in German, whether a
 * castle could be mentioned in their entry was answered *"I would rather not
 * give you a figure I have not added up properly"*, which has no reading
 * except that the software is broken.
 *
 * A real total puts the two together: *"insgesamt 64 Euro"*, *"240 Franken
 * gekostet"*, *"an average of 53.50 pounds"*. Fifteen characters is a few
 * words, and it is what separates them.
 */
const TOGETHER = 15;

/** Every tool's own name, by kind — computed once from the registry rather
 *  than typed out a second time. */
const READ_TOOL_NAMES = new Set(TOOLS.filter((tool) => tool.kind === "read").map((tool) => tool.name));
const WRITE_TOOL_NAMES = new Set(TOOLS.filter((tool) => tool.kind === "write").map((tool) => tool.name));

/**
 * A closed, small class of words that ask for a **fact** — as opposed to a
 * polite way of asking for an *action*, which is a bare `?` and nothing more.
 *
 * The first version of this check fired on a bare `?`: *"could you write up
 * today? we went to the museum and then the harbour"* produces exactly one
 * write, reads nothing, and asks nothing else — and was flagged anyway, a
 * false positive on what is likely the single most common sentence in this
 * whole product. *"Shall I put this in for the 14th?"* and *"can you save
 * that?"* are the same shape and were caught the same way.
 *
 * What actually marks a second, unanswered ask is not the `?` but a
 * fact-seeking word riding along with it — "what", "how many", "remind me",
 * "wie viel", "hány". Unlike the claim-phrasing AGENTS.md warns against
 * matching on — an open, ever-growing space of ways to say "it's done" — the
 * words that ask for a fact rather than for an action are a small, closed
 * grammatical class per language, the same kind of list this file already
 * keeps for other checks (`A_TOTAL`, `CLAIM`, `DENIED`). It will still miss a
 * fact question that avoids every word here, and that is a missed catch
 * rather than a false one — the side AGENTS.md says to prefer when a guard
 * cannot be made to hold both ways at once.
 */
const FACT_QUESTION_WORD =
  /\b(what|when|where|who|whose|which|how many|how much|remind me)\b|\b(was|wann|wo|wer|wessen|welche[rsn]?|wieso|weshalb|wie ?viele?|erinnere)\b|\b(mit|hány\w*|mikor|milyen|mennyi\w*|melyik|mondd meg)\b/i;

/**
 * A second ask, inside the same message, that this turn never came back to —
 * B952.
 *
 * *"could you change the title of the 22nd to Homeward Bound … and also
 * remind me what currency this journal counts money in…"* proposed the title
 * and never mentioned the currency again — not answered, not refused, not
 * flagged as skipped. Nothing untrue was said, which is why it slips past
 * every check above: those catch a claim that is false, and an omission
 * makes none.
 *
 * What is checkable is not whether the person's sentence "really" asked two
 * things, but whether the turn's own actions are shaped like an answer to
 * only one of them: a fact-seeking word in what they typed (`FACT_QUESTION_WORD`)
 * says a fact was asked for; a write tool with no read tool alongside it is a
 * turn that produced a change and consulted nothing to answer a fact with.
 * Together they are the signature of the fault above, checked against the
 * turn rather than against the words the model chose.
 *
 * A turn that reads nothing at all (`looked.length === 0`, an answer straight
 * from the conversation) is left alone: it was never going to consult a tool
 * for either half, so there is nothing to tell an honest one-part answer from
 * a dropped two-part one.
 */
export function droppedAQuestion(said: string, looked: string[]): boolean {
  if (!FACT_QUESTION_WORD.test(said)) return false;
  if (!looked.some((name) => WRITE_TOOL_NAMES.has(name))) return false;
  return !looked.some((name) => READ_TOOL_NAMES.has(name));
}

export function claimsATotal(text: string): boolean {
  return withoutMarkers(text)
    .split(/(?<=[.!?\n])\s+/)
    .some((sentence) => {
      const totals = [...sentence.matchAll(new RegExp(A_TOTAL.source, "gi"))];
      if (totals.length === 0) return false;
      const figures = [...sentence.matchAll(new RegExp(A_FIGURE.source, "gi"))];
      return totals.some((word) =>
        figures.some((figure) => {
          const wordStart = word.index ?? 0;
          const wordEnd = wordStart + word[0].length;
          const figureStart = figure.index ?? 0;
          const figureEnd = figureStart + figure[0].length;
          // Overlapping (some patterns carry the digit themselves), or within
          // a few words either way.
          return figureStart - wordEnd <= TOGETHER && wordStart - figureEnd <= TOGETHER;
        }),
      );
    });
}

/**
 * What the model is told when it has claimed a write it did not make — B920.
 *
 * A retry rather than a strip: stripping leaves a hole in a paragraph and
 * tells nobody anything, and a retry usually produces the proposal that
 * *should* have been there, which is the answer the person wanted. It costs
 * one turn.
 */
const HONESTY_RETRY = `Stop. Your last answer described something that is not on their screen — a day saved, started, published or added, or a button to press — and this turn carries no proposal, so nothing has changed in their journal and there is nothing there to press.

You may not describe anything they cannot see. No button, no "press it", nothing "below", and never tell them to reload the page or their browser: the page is not the problem and saying so sends them hunting for a fault of their own.

Answer again. Either call the tool that proposes what they asked for — that is what puts a button in front of them — or say plainly, in their language, that nothing has been saved yet and what you need from them.`;

/**
 * What the model is told when it has said somebody can read something — B931.
 *
 * The retry is worth more here than anywhere else, because the answer it
 * produces is one that did not exist before this ticket: the invitation.
 */
/**
 * What the model is told when it described the proposal it has just made as a
 * thing already done — B944.
 *
 * Deliberately not `HONESTY_RETRY`, which says *"nothing has changed and there
 * is nothing there to press"*. Here there **is** something to press, and
 * telling the model otherwise is asking it to correct a true half of its
 * answer. What is wrong is only the tense.
 */
const PENDING_RETRY = `Stop. Your last answer said something had been done — a day saved, started, published, taken down or added to — and it has not been. What is on their screen is a proposal, and it does nothing until they press it.

Say it again in the tense that is true: what *would* happen, and that pressing is what makes it so. Do not apologise and do not explain yourself; just say it correctly. The button is right there and it is the one you already made, so do not make another.`;

/**
 * What the model is told when it said somebody's words were in a proposal that
 * has nowhere to put them — B961.
 */
const WORDS_RETRY = `Stop. Your last answer said their own words are in what you proposed, and the proposal on their screen has no place for words at all — it is an empty day with a date on it, and nothing they said has been written down anywhere.

Say what is actually there: a day waiting to be started, and that the words come after it, once they press. Then offer to write them up. Do not describe prose that does not exist, however sure you are of what it would say.`;

/**
 * What the model is told when the total it was handed was a partial one — B960.
 */
const PARTIAL_RETRY = `Stop. The costs you read said plainly that some of their spending is NOT in that total — it is in a currency this trip has no rate for, and it was left out. You gave them the smaller number as though it were the whole thing.

Answer again with both: the total as far as it goes, and then the money that is not in it, named by its currency and its amount, in the words \`notInTheTotal\` gave you. Do not convert it yourself and do not guess a rate. "Two hundred francs, and 4 500 dinars besides that I cannot convert" is the true answer and it is not a worse one.`;

/**
 * What the model is told when it put a figure about money into an answer that
 * nothing computed — B963.
 */
const INVENTED_RETRY = `Stop. There is a number about money in your last answer that the costs did not contain. You worked it out yourself, and you may not: you do not know today's rate, and the reason that money is outside the total is that this trip has no rate for it.

Answer again using only the figures you were given. If they ask what the rest comes to, say plainly that you cannot convert it and that the amount is what it is — "15 BAM and 1500 MKD" is the whole answer, and it is a better one than a guess dressed up as help.`;

/**
 * What the model is told when it acted on one half of a message and never
 * came back to the other — B952.
 */
const DROPPED_RETRY = `Stop. Look at their message again — it asked you something as well as asking for a change, and you read nothing before answering, so the question could not have been answered from anything but memory or guesswork.

Answer again with both halves: keep what you already did for the change, and now use a tool to answer the question truthfully, or say plainly that you have not gotten to it yet. Never let a second question go unmentioned — a person who asked two things and hears about only one has no way to know whether the other was refused, forgotten, or still coming.`;

/**
 * A date format, which is never something to say to a person — B1041.
 *
 * There is a date picker. Naming `YYYY-MM-DD` is asking somebody to be a
 * database, and it is the single most reliable tell that a paragraph is doing
 * a card's job: nothing else in this product has any reason to write it.
 *
 * Deliberately narrow. Two or three field names in bold would catch more and
 * would also catch an honest answer explaining what a card is about to ask —
 * this catches the sentence that is only ever wrong.
 */
const DATE_FORMAT = /\b(?:yyyy[-./]mm[-./]dd|jjjj-mm-tt|tt\.mm\.jjjj|éééé-hh-nn)\b/i;

/** True when the answer is asking for values a card would have asked for. */
/**
 * The list, said a second time — B1161.
 *
 * `past_conversations` draws four rows a person can press, and the model then
 * wrote underneath: *"You have 18 earlier conversations. The most recent was
 * about making your trip visible to guests. Others include renaming your
 * journal to Reisen mit Renate…"* — the same answer twice, once as a control
 * and once as prose nobody can press.
 *
 * B1120 fixed this in the tool's `describe`, in words. It did not hold, which
 * is the third time this file has learned the same thing: **rewording did not
 * fix any of these and a code guard fixed all of them** (B829). So this is the
 * guard.
 *
 * ## Why length, and not matching what it said
 *
 * The obvious version compares the answer against the labels in the block and
 * fires when enough of them come back. It does not work, and the live evidence
 * is why: the model *paraphrased*. "rename my journal to Reisen mit Renate"
 * came back as "renaming your journal to Reisen mit Renate". Matching text
 * would need to catch every rewording, which is the list that is always
 * missing its next entry — exactly what this file's own header warns against.
 *
 * So the condition is the shape of the turn, which the server knows for
 * certain: **a block already lists the things, and the answer beside it is
 * long.** When the answer is on screen as a list, the sentence next to it has
 * one job — say what the list is and how to use it. Two sentences do that.
 * Anything past that is the list again, whatever words it chose.
 *
 * The threshold is deliberately generous. A guard that fires on an honest turn
 * is a bug and as serious as one that misses, so this leaves room for a real
 * sentence and catches only a paragraph.
 */
const A_SENTENCE_OR_TWO = 240;

/** Rows a person can already press or read, on this turn. */
function alreadyListed(blocks: Block[]): number {
  return blocks.reduce((most, block) => {
    if (block.shape === "choose") return Math.max(most, block.options.length);
    if (block.shape === "files") return Math.max(most, block.files.length);
    return most;
  }, 0);
}

export function saysTheListAgain(text: string, blocks: Block[]): boolean {
  // Three is where a list becomes a list. Two rows and a sentence naming both
  // is a person being told what they are looking at.
  if (alreadyListed(blocks) < 3) return false;
  return withoutMarkers(text).trim().length > A_SENTENCE_OR_TWO;
}

export function asksForFields(text: string): boolean {
  return DATE_FORMAT.test(withoutMarkers(text));
}

/**
 * What the model is told when it said the list twice — B1161.
 */
const LIST_RETRY = `Stop. The list is already on their screen — you drew it, as rows they can press — and then you wrote it out again underneath as a paragraph they cannot. Say what the list is and how to use it, in a sentence or two, and stop there. Do not name the rows one by one: they are looking at them.`;

/**
 * What the model is told when it wrote a paragraph where a card belongs.
 */
const FIELDS_RETRY = `Stop. You asked them to type values — a date in a format, or fields one by one — and there is a card for that. A write tool does not write: it puts the fields on their screen, editable, with one button, and only their press changes anything. The proposal IS the question you just asked, and a better one, because they can see and correct every field before pressing.

Call the tool now, with whatever you already know filled in and the rest left empty. Never write a date format to a person: there is a date picker.`;

const ACCESS_RETRY = `Stop. Your last answer said a person can read something, and nothing on this turn makes that true. Naming somebody does not let them in: a trip that is not public is open to the people who were on it and to the guests the owner has already approved, and nobody else. Saying otherwise is the worst thing you can get wrong here — this journal exists so that somebody's family can read it, and they will believe you.

Answer again. If they want that person to read it, call invite_guest: it proposes a link for them to send. Say what the link is — the person opens it, proves their own address, and then asks; they can read nothing until the owner approves them. Otherwise say plainly, in their language, that the person has not been invited yet and cannot read it.`;

/**
 * What the model is told when it has said what a day says — B932.
 */
const READ_IT_RETRY = `Stop. Your last answer said what a day contains, and you did not read that day on this turn. You do not remember their words and you must not describe them from memory.

Answer again. Call read_day first, and quote the words that are actually there back to them — a quote they can check, not a summary. If the day does not say what they are asking about, say so, and propose the change.`;

/**
 * What the model is told when it has totalled somebody's money itself — B955.
 */
/**
 * What the model is told when it said whether a day was on the site without
 * looking — B970.
 */
const IS_IT_UP_RETRY = `Stop. Your last answer said whether a day is on the site, and you did not read that day on this turn. Their having pressed something is not the same fact: what makes a day published is the day.

Answer again after calling read_day. It tells you whether that day is a draft, and that is the only thing that does. They are asking because they are not sure, and a guess that happens to be right is the same sentence as a guess that is wrong.`;

const COUNT_IT_RETRY = `Stop. Your last answer said what something adds up to, and you did not read this trip's costs on this turn. You cannot add up from memory: you will miss what was recorded a minute ago, and a wrong number about somebody's money reads exactly like a right one.

Answer again. Call trip_costs — it returns the total, the daily average and how many days have nothing recorded, all worked out from what is actually written down — and give them those figures. If you would rather not call it, say the total without a number and tell them to ask again.`;

/**
 * How often a turn claimed a write it had not made — B920.
 *
 * A counter rather than a log line per turn: the *rate* is what says whether
 * the prompt is at fault or the model is, and it is read by `/api/health` and
 * by the test. Never a person's words, never a journal name; two integers.
 */
const honesty = { turns: 0, claimed: 0, unrecovered: 0 };

/** The claim-without-proposal rate since this process started. */
export function honestyCounts(): { turns: number; claimed: number; unrecovered: number } {
  return { ...honesty };
}

/**
 * One turn: the conversation so far, one new sentence, and a few tool calls.
 *
 * Throws only when the model itself fails — the route answers `502` and the
 * person's own words are still in the box. A tool that fails is not a failure
 * of the turn: `runTool` hands the model a value it can read, and the answer
 * is a sentence about it.
 *
 * `selected` is what is ticked in the files pane, passed through to the tools
 * so that `attach_files` resolves it itself — B925. Nobody is ever asked to
 * read an id off a screen that does not show one.
 */
export async function answerInThread(
  username: string,
  said: string,
  turns: Turn[],
  today: string,
  say: Say,
  selected: string[] = [],
  journalLocale?: string,
): Promise<ThreadAnswer> {
  const client = new Anthropic();
  /**
   * The conversation, with the notes folded in — B924.
   *
   * A note is written for the model and rides on the **next user message**,
   * exactly as the files pane's selection line already does. Nothing the model
   * wrote is ever handed back to it with a marker inside, so there is nothing
   * for it to imitate.
   */
  const messages: Anthropic.MessageParam[] = [];
  let pending = "";
  for (const turn of turns) {
    if (turn.role === "note") {
      pending = pending === "" ? turn.text : `${pending}\n${turn.text}`;
      continue;
    }
    if (turn.role === "user") {
      messages.push({ role: "user", content: pending === "" ? turn.text : `${turn.text}\n${pending}` });
      pending = "";
      continue;
    }
    messages.push({ role: "assistant", content: turn.text });
  }
  messages.push({ role: "user" as const, content: pending === "" ? said : `${said}\n${pending}` });

  const looked: string[] = [];
  /**
   * Currencies a total left out, from the tool that knows — B960.
   *
   * `trip_costs` reports what it could not convert, and a total that does not
   * mention it is smaller than what somebody spent. Six costs in three
   * currencies came back as *"Total for the trip so far: 31 CHF"*, being the
   * two in CHF, with nothing said. The costs page has always said "and 4 200
   * THB besides"; only the conversation was silent.
   *
   * Kept here rather than checked inside the tool because the claim is the
   * *answer's*, and the answer is written after the tool has spoken.
   */
  const leftOut: string[] = [];
  /**
   * Every figure the cost tool returned this turn — B963.
   *
   * Asked for a rough number, the conversation named the money it could not
   * convert — correctly — and then offered *"about 30 CHF worth if you want a
   * fuller number"* for 15 BAM and 1500 MKD. Unprompted, and not far out,
   * which is what makes it dangerous rather than obviously wrong: the trip has
   * no rate for either currency, which is exactly why they were excluded.
   *
   * B960 made the conversation honest about what it left out. This is the
   * model filling the hole back in from its own belief one sentence later,
   * because a blank felt unhelpful. AGENTS.md has one rule and this is it: an
   * empty field beats a plausible fiction.
   *
   * So a figure said about money must be one the server produced. Rounding is
   * allowed — *"roughly 240"* for 240.476 is the same claim — and inventing is
   * not.
   */
  const counted: number[] = [];
  const blocks: Block[] = [];
  const proposals: Proposal[] = [];

  /** The rounds, over the messages built above. Returns what it said. */
  async function rounds(): Promise<string> {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await client.messages.create({
        model: HELPER_MODEL,
        max_tokens: THREAD_MAX_TOKENS,
        system: threadSystemPrompt(today, journalLocale),
        tools: toolSchemas(),
        messages,
      });
      await book(username, "ask_thread", response.usage);

      const calls = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );
      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();

      if (calls.length === 0) return text;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of calls) {
        looked.push(call.name);
        const { ok, result, blocks: drawn, proposal } = await runTool(
          username,
          call.name,
          call.input,
          say,
          today,
          selected,
        );
        blocks.push(...drawn);
        if (proposal) proposals.push(proposal);
        if (call.name === "trip_costs") {
          const said = result as { notInTheTotal?: { currency?: unknown }[] } | null;
          for (const one of said?.notInTheTotal ?? []) {
            if (typeof one.currency === "string") leftOut.push(one.currency);
          }
          // Every figure this tool actually produced — B963. What is not in
          // here, and is said about money, was invented.
          for (const number of numbersIn(result)) counted.push(number);
        }
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          is_error: !ok,
          content: JSON.stringify(result).slice(0, 20000),
        });
      }
      messages.push({ role: "user", content: results });
    }

    // Four rounds and it is still calling tools. Rather than a fifth, ask for
    // the answer with the tools taken away — the reads are all in the
    // conversation by now, and a sentence about them is what was wanted.
    const last = await client.messages.create({
      model: HELPER_MODEL,
      max_tokens: THREAD_MAX_TOKENS,
      system: threadSystemPrompt(today, journalLocale),
      messages,
    });
    await book(username, "ask_thread", last.usage);
    return last.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim();
  }

  honesty.turns += 1;
  let answer = withoutMarkers(await rounds());

  /**
   * The claim and the act, checked against each other — B920.
   *
   * One retry, and then the truth plainly: if it says a second time that
   * something was saved while nothing is waiting to be pressed, its own words
   * are dropped rather than shown. A hole in a paragraph is survivable; being
   * told your day is safe when it is not is what put somebody's phone down.
   */
  /**
   * Three things a turn can be wrong about, and each of them is a thing the
   * person can check: the write that did not happen (B920) and the button
   * that is not there (B928), who can read it (B931), and what a day says
   * (B932). One retry each, with the reason it was caught, and then the truth
   * plainly in the person's own language.
   */
  /**
   * Which tools this conversation has actually written with — B939's notes,
   * read back. `[written: publish_day {…}]`, so the name is the first word.
   */
  const written = new Set(
    turns
      .filter((turn) => turn.role === "note")
      .map((turn) => /^\[written: (\w+)/.exec(turn.text)?.[1])
      .filter((name): name is string => name !== undefined),
  );

  /**
   * Figures in a sentence, next to a currency — B963.
   *
   * Only currency-adjacent numbers, so a date, a day count or a credit balance
   * is not mistaken for money.
   */
  function moneyIn(text: string): number[] {
    const found: number[] = [];
    for (const hit of text.matchAll(MONEY_FIGURE)) {
      const raw = (hit[1] ?? hit[2] ?? "").replace(/[\u00a0' ]/g, "").replace(/,(?=\d{3}\b)/g, "");
      const value = Number(raw.replace(",", "."));
      if (Number.isFinite(value)) found.push(value);
    }
    return found;
  }

  function amiss():
    | ""
    | "claim"
    | "pending"
    | "words"
    | "access"
    | "day"
    | "up"
    | "total"
    | "partial"
    | "invented"
    | "dropped"
    | "fields"
    | "list" {
    /**
     * **A paragraph where a card belongs** — B1041, and it is the fault the
     * whole product is arranged against.
     *
     * Pressing "Neue Reise" got: *"Ich brauche ein paar Angaben von dir:
     * **Titel** … **Startdatum**: Wann beginnt sie? (YYYY-MM-DD) …
     * **Sichtbarkeit**: alle, nur Gäste, oder nur die Personen, die mitgereist
     * sind?"* Every one of those is a field on the card `create_trip` would
     * have proposed — a title box, two date pickers, and a select whose three
     * options are those three sentences as labels.
     *
     * So somebody was asked to type a date in a format, by a tool whose entire
     * purpose is to put a date picker in front of them.
     *
     * The prompt already says to call the write tool as soon as the want is
     * understood, because the proposal *is* the confirmation. It was
     * understood. B829's finding holds for the third time: the prompt is not
     * the lever, and this is.
     *
     * Checked before everything else because it is about the *shape* of the
     * turn rather than the truth of a sentence — and a turn that should have
     * been a card is one where nothing else has been decided yet.
     */
    if (proposals.length === 0 && asksForFields(answer)) return "fields";
    // B1161 — the rows are on screen; the paragraph under them is the same
    // answer again, in a form nobody can press.
    if (saysTheListAgain(answer, blocks)) return "list";
    if (claimsAccess(answer) && !proposals.some((one) => one.tool === "invite_guest")) {
      return "access";
    }
    if (claimsWhatADaySays(answer) && !looked.includes("read_day")) return "day";
    /**
     * B970 — whether it is on the site, asserted without looking. The press
     * having happened is not the same fact as the day being up, so a written
     * note does not excuse it: `read_day` is what knows.
     */
    if (claimsItIsUp(answer) && !looked.includes("read_day")) return "up";
    // B955 — the arithmetic is the server's and was not asked for it.
    if (claimsATotal(answer) && !looked.includes("trip_costs")) return "total";
    /**
     * B960 — it *did* ask, and the answer it got said the total was partial.
     * A figure repeated without that is a smaller trip than the one somebody
     * took, said with the authority of a number read off disk.
     */
    if (
      claimsATotal(answer) &&
      leftOut.length > 0 &&
      !leftOut.some((currency) => new RegExp(`\\b${currency}\\b`, "i").test(answer))
    ) {
      return "partial";
    }
    /**
     * A figure about money that the server did not produce — B963.
     *
     * Within two per cent of something `trip_costs` returned is the same
     * claim rounded, which is ordinary and fine. Anything else, said about
     * money on a turn that read the costs, is a number from the model's own
     * belief — and the one it was caught at was a conversion for a currency
     * it had just said it could not convert.
     */
    if (counted.length > 0) {
      const invented = moneyIn(answer).filter(
        (said) => !counted.some((real) => Math.abs(said - real) <= Math.max(0.02 * Math.abs(real), 0.01)),
      );
      if (invented.length > 0) return "invented";
    }
    /**
     * A question that rode along with a change and never got an answer —
     * B952. Checked against what this turn did, not against the answer's own
     * words: a write tool fired, a fact-seeking word was in what they typed,
     * and no read tool ever ran to answer it with.
     */
    if (droppedAQuestion(said, looked)) return "dropped";
    /**
     * Words claimed to be in a proposal that has nowhere to put them — B961.
     *
     * Outside the block below because it is the one claim that is false while
     * a proposal really is on the screen and nothing was said to be saved:
     * every other check passed the sentence that found it.
     */
    if (
      claimsProposedWords(answer) &&
      proposals.length > 0 &&
      !proposals.some((one) => one.fields.some((field) => field.name === "content"))
    ) {
      return "words";
    }
    if (claimsWhatIsNotThere(answer)) {
      /**
       * **The turn that proposes is the turn most tempted to describe it as
       * done** — B944, and it was the one turn this check did not run on. The
       * condition was `proposals.length === 0`, so a proposal on the screen
       * bought the answer past it.
       *
       * Two testers found it the same afternoon, from opposite ends. A
       * designer asked to take a day off the site and read *"The 4th is now a
       * draft again"* with the day still published and nothing pressed. A
       * blind reader heard *"I've started the empty day for Thursday"* with
       * the proposal sitting unpressed — and for them the sentence is the
       * whole of what they know, so there is nothing to check it against.
       *
       * What makes it decidable is the tool's own name. A claim is allowed
       * about something this conversation really wrote; it is not allowed
       * about the thing waiting to be pressed. So a pending proposal whose
       * tool has never been written with is the flag — which leaves *"the
       * words are saved, shall I publish?"* alone, because `set_day_words` is
       * in the set and `publish_day` is what is pending.
       */
      if (claimsAWrite(answer) && proposals.some((one) => !written.has(one.tool))) {
        return "pending";
      }
      /**
       * And the other direction, which B943 found from its own end: with no
       * proposal and nothing ever written, a claim is false and this is where
       * it was already caught. With something written, it is a true sentence
       * about a press that happened, and flagging it is what led to the
       * replacement denying the whole journal.
       */
      if (proposals.length === 0) {
        /**
         * A button that is not there — B928, and B953 is why this is its own
         * line. It is false whenever the turn proposed nothing, whatever the
         * conversation has written before: nobody can press what is not on
         * the screen, and the person goes looking for it.
         *
         * **Except when a `choose` or `confirm` block really did draw
         * something to press this turn** — B1056. Neither shape produces a
         * `Proposal` (only a write tool's `form`/`confirm` with `.proposal`
         * set does, and a `choose` never does), so `proposals.length === 0`
         * was true on every one of them and the check had no way to tell "a
         * button that is not there" from "the three rows this very turn
         * drew". `ON_SCREEN`'s wording talks about a screen because it was
         * written against one; the true condition was always "something the
         * model can honestly say is in front of them", and a block is that
         * regardless of whether "in front of them" means a page or a chat
         * bubble — which is the fix a second channel with no page needed.
         */
        const drewSomethingToPress = blocks.some((one) => one.shape === "choose" || one.shape === "confirm");
        if (!drewSomethingToPress && claimsAButton(answer)) return "claim";
        /**
         * A write, which is the half B943's evidence narrowed. With something
         * really written and nothing proposed, a past-tense sentence is a true
         * report of a press, and flagging it is what led to the replacement
         * denying the whole journal.
         */
        if (written.size === 0 && claimsAWrite(answer)) return "claim";
      }
    }
    return "";
  }

  const RETRY = {
    claim: HONESTY_RETRY,
    fields: FIELDS_RETRY,
    list: LIST_RETRY,
    pending: PENDING_RETRY,
    words: WORDS_RETRY,
    access: ACCESS_RETRY,
    day: READ_IT_RETRY,
    up: IS_IT_UP_RETRY,
    total: COUNT_IT_RETRY,
    partial: PARTIAL_RETRY,
    invented: INVENTED_RETRY,
    dropped: DROPPED_RETRY,
  };
  /**
   * What is said when the model could not be made to say something true.
   *
   * **The replacement is itself a claim** — B943 — and it has been false. It
   * denied the whole journal (*"nothing has been saved and nothing has
   * changed"*) to somebody who had just watched a day appear. B944's condition
   * above is what fixed that, at the source: the sentence is now only reached
   * when this conversation really has written nothing, which is the one state
   * it describes correctly.
   */
  const PLAINLY = {
    claim: "agent.nothingHappened",
    fields: "agent.nothingHappened",
    pending: "agent.notUntilYouPress",
    words: "agent.noWordsProposed",
    access: "agent.noAccessYet",
    day: "agent.notRead",
    up: "agent.notRead",
    total: "agent.notCounted",
    partial: "agent.notCounted",
    invented: "agent.notCounted",
    dropped: "agent.stillHasAQuestion",
    // B1161 — the rows are already drawn, so the honest fallback is the
    // shortest sentence there is: look at them.
    list: "agent.theListIsAbove",
  } as const;

  const wrong = amiss();
  // What was caught and whether the second answer was honest — kept so the row
  // this turn writes can say so (B976), rather than only the counter.
  const caught = wrong;
  let recovered = false;
  if (wrong !== "") {
    honesty.claimed += 1;
    messages.push({ role: "assistant", content: answer === "" ? "…" : answer });
    messages.push({ role: "user", content: RETRY[wrong] });
    answer = withoutMarkers(await rounds());
    const again = amiss();
    if (again !== "") {
      honesty.unrecovered += 1;
      answer = say(PLAINLY[again]);
    } else {
      recovered = true;
    }
  }

  return { answer, looked, blocks, proposals, guard: caught, recovered };
}

/* -------------------------------------------------------------------------
 * Finding something by what it was, not by what it was called — B904.
 *
 * MiniSearch matches tokens and is instant and free; this is the second half,
 * for the sentence whose words are nowhere in the journal — "the day we got
 * lost near the border", "wo war das teuerste Hotel". The model is given the
 * catalogue the reader is already entitled to (`searchCatalogueFor`) and one
 * sentence, and returns **ids from that list**. It cannot return a URL, and
 * the route resolves ids against the same list it sent, so a hallucinated row
 * lands nowhere rather than on a plausible page that does not exist.
 * ---------------------------------------------------------------------- */

const FIND_SYSTEM_PROMPT = `You are helping somebody find something in their own travel journal. You are given a list of everything they can look at — days, trips, pages and documentation — and one sentence saying what they are after.

Return the rows that actually answer it, best first, at most six. Match on meaning: they will describe what happened, how it felt or roughly when, and the row's title is often none of those words. A place they name, a date they half-remember and a trip they mention are all fair evidence.

Only ever return ids that appear in the list you were given. You have no other knowledge of this journal: you cannot open a day, you cannot see its prose, and you must not invent a row, a place or a date that is not in front of you.

If nothing in the list fits, return no rows at all. That is a real answer and often the right one — a wrong row costs them more than an empty list, which at least tells them to try other words.

"why" is one short clause in the language they asked in, saying what makes this row the answer. Never a sentence about yourself, never an apology.

When you are told the sentence was **spoken**, it reached you through a transcriber and a word may have been misheard. If — and only if — the words look like a mishearing of something that is *in the list you were given*, put what you think they actually said in "suggestion". "Kotthard" against a journal whose days name the Gotthard is not a guess, it is the nearest real thing; "the day with the boat" against a journal with no boat in it is not a mishearing, it is a day they are looking for and have not found.

Leave "suggestion" empty unless a name in the list is what makes it work. A correction that names nothing in this journal is not a correction — it is you rewriting somebody's question into one you would rather answer. Empty is the normal answer, and it costs them nothing.`;

type FoundRow = { id: string; why: string };

/** One search, answered: the rows it matched, and — for a sentence that was
 *  spoken — what the model thinks was actually said (B1006). The suggestion
 *  is empty unless a name in the catalogue is what makes the correction work. */
export type Found = { hits: FoundRow[]; suggestion: string };

const FIND_SCHEMA = {
  type: "object",
  properties: {
    suggestion: { type: "string" },
    hits: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, why: { type: "string" } },
        required: ["id", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["hits", "suggestion"],
  additionalProperties: false,
};

/** What one row looks like to the model. Tab-separated rather than JSON: the
 *  catalogue is the bulk of the request and this is half the tokens. */
function catalogueLines(rows: { id: string; kind: string; title: string; where: string }[]): string {
  return rows.map((r) => `${r.id}	${r.kind}	${r.title}	${r.where}`).join("\n");
}

/**
 * One request, and a broken answer is an empty one. Nothing here throws for a
 * model that returns nonsense: the caller's screen is the local search
 * results, which are already on it.
 */
export async function findInJournal(
  said: string,
  rows: { id: string; kind: string; title: string; where: string }[],
  today: string,
  owner?: string,
  spoken = false,
): Promise<Found> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 600,
    system: FIND_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Today is ${today}.\n\n` +
          (spoken
            ? "They said this out loud and a transcriber wrote it down, so a word may have been misheard.\n\n"
            : "They typed this.\n\n") +
          `What they are looking for:\n${said.trim()}\n\n` +
          `Everything they can look at, one per line as id, kind, title, where:\n` +
          catalogueLines(rows),
      },
    ],
    output_config: { format: { type: "json_schema", schema: FIND_SCHEMA } },
  });
  await book(owner, "find_in_journal", response.usage);

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  try {
    const parsed = JSON.parse(text) as { hits?: unknown; suggestion?: unknown };
    const hits = Array.isArray(parsed.hits)
      ? parsed.hits
          .filter((hit): hit is FoundRow => {
            const row = hit as Record<string, unknown>;
            return typeof row?.id === "string" && typeof row?.why === "string";
          })
          .slice(0, 6)
      : [];
    const suggestion = typeof parsed.suggestion === "string" ? parsed.suggestion.trim() : "";
    return {
      hits,
      // A "correction" identical to what they said is not one, and offering it
      // reads as the software not having listened.
      suggestion: suggestion.toLowerCase() === said.trim().toLowerCase() ? "" : suggestion,
    };
  } catch {
    return { hits: [], suggestion: "" };
  }
}
