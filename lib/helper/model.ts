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
import { intentList, REGISTRY, type Say } from "./intents";
import type { Turn } from "./thread";
import { runTool, toolList, toolSchemas } from "./tools";

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

DESCRIBE ONLY WHAT IS VISIBLE IN THE FRAME. Do not name a place, a country, a landmark or a business — even one you recognise, even if signage in the photograph names it — because a caption is not the place to turn a guess into a fact. Never identify a person: no name, no relationship, no guess at who somebody is. You may describe what is visibly happening (someone is walking, someone is cooking) but never who. Never guess a mood, an occasion, a reason, or anything about what the day meant. A plain caption of what is actually in the frame — the colours, the setting, the action — beats a caption that reaches for any of that, and an empty caption is the correct answer for a photograph you cannot describe without guessing.

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
 * The router — B685, §3 of the plan.
 *
 * One sentence in, a row name and some strings out. It lives in this file
 * because this file is the one place a model is spoken to, and the prompt
 * below is as much the product as the write-up prompt above it.
 *
 * **The model is handed no client, no tools and no ability to call
 * anything.** What it returns is looked up in `./intents.ts` by code, and
 * every write is confirmed by a person afterwards however sure it sounded.
 * ---------------------------------------------------------------------- */

/** What comes back when nothing fits. Not an error and not an apology — it
 *  lands the person on the buttons that were already on their screen. */
export const UNKNOWN_INTENT = "unknown";

/**
 * The router's system prompt.
 *
 * **The list of things it can route to is generated from the registry**
 * (`intentList()`), which is the only reason this prompt can be trusted a
 * month from now: a hand-typed menu here would promise a capability somebody
 * deleted, or hide one somebody added, and neither failure looks like a bug
 * from the outside — it looks like the helper being stupid.
 */
export const ROUTER_SYSTEM_PROMPT = `You are the front door of somebody's travel journal. They have typed or spoken one sentence at it. Your only job is to say which of the things below they are asking for, and to pull out the fields it needs.

You do not do the thing, and you cannot: you have no tools, no access to the journal, and nothing you return happens until the person has read it on their own screen and pressed a button.

The things this helper can do:
${intentList()}

The rules:

Return exactly one intent. If they asked for two things, take the first one they asked for; they will be asked about the rest afterwards.

If nothing above fits, or you find yourself guessing, return "${UNKNOWN_INTENT}" with no slots. That is a real answer and often the right one — it puts them back on the menu of buttons they already had. A wrong guess costs them more than no guess.

Fill a slot only from what they actually said. Do not invent a title, a place, a trip or a date that is not in their sentence. An empty slot is better than a plausible one: an empty box is a box they fill in, a wrong one is a mistake they have to notice first.

Dates are YYYY-MM-DD, worked out from today's date, which is given to you. A month named with no year means the nearest such month that has not yet ended. A month with no day means its first day for a start and its last day for an end.

Confidence is between 0 and 1: how sure you are that this is the row they meant. Be honest and low rather than polite and high.

Never write prose, an explanation or an apology. You return a row name, a few short strings, and a number.`;

export type Routed = { intent: string; slots: Record<string, unknown>; confidence: number };

/** Every slot name in the registry, so the schema is generated too. */
function slotProperties(): Record<string, { type: "string" }> {
  const out: Record<string, { type: "string" }> = {};
  for (const row of REGISTRY) for (const slot of row.slots) out[slot.name] = { type: "string" };
  return out;
}

function routerSchema() {
  return {
    type: "object",
    properties: {
      intent: { type: "string", enum: [...REGISTRY.map((r) => r.name), UNKNOWN_INTENT] },
      slots: { type: "object", properties: slotProperties(), additionalProperties: false },
      confidence: { type: "number" },
    },
    required: ["intent", "slots", "confidence"],
    additionalProperties: false,
  };
}

/**
 * One request. Anything that does not parse comes back as `unknown`, which is
 * a first-class answer here — a broken response and a sentence nobody
 * understood deserve the same screen, and it is the screen that always works.
 */
export async function routeAsk(said: string, today: string, owner?: string): Promise<Routed> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: HELPER_MODEL,
    max_tokens: 300,
    system: ROUTER_SYSTEM_PROMPT,
    messages: [
      { role: "user", content: `Today is ${today}.\n\nWhat they said:\n${said.trim()}` },
    ],
    output_config: { format: { type: "json_schema", schema: routerSchema() } },
  });
  await book(owner, "route_ask", response.usage);

  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      intent: typeof parsed.intent === "string" ? parsed.intent : UNKNOWN_INTENT,
      slots: (parsed.slots ?? {}) as Record<string, unknown>,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
    };
  } catch {
    return { intent: UNKNOWN_INTENT, slots: {}, confidence: 0 };
  }
}

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
export function threadSystemPrompt(today: string): string {
  return `You are the helper inside somebody's own travel journal, called Fernscout. You are talking to the person who owns it. They have said something to you, in their own words, in whatever language they speak. Today is ${today}.

Answer in prose, in the language they used. Never translate anything of theirs into another language.

Say what you looked at. If you read the trips, or the costs, or the storage, name that in your answer — one short clause is enough — so they can tell what your answer rests on.

WHAT YOU CAN DO

You can look things up. These are the tools:
${toolList()}

Call them when the answer needs one. Call more than one when it needs more than one. If a question is about the software rather than about their journal — how something works, what something is for — answer it from what is written below without calling anything.

WHAT YOU CANNOT DO, AND WHAT TO SAY INSTEAD

You cannot change this journal yourself. Nothing you call writes, publishes, deletes, uploads or sends anything, so nothing you say can alter a single file. Two of the tools do less than their names suggest, and saying so is part of the answer: new_trip fills a form in and stops — the trip does not exist until they press — and day_helper only hands them a page. That is deliberate, not something to apologise for. When they ask for something, say what will actually happen and name the control that finishes it, in a sentence or two, so it reads as directions and not as a refusal:

- Writing up a day, adding photographs to it, or correcting one already written: the day_helper tool hands them the page that does all of it.
- Publishing a day: from that day's own preview, where they read it as their readers will see it and press once. It never happens from a sentence.
- Changing a trip's title, dates or who may read it: the trip form on their journal.
- Costs: the costs page of the trip, or a bank statement imported there.
- Printed postcards: proposed first, then looked at and pressed on their journal's postcards page. Nothing is printed until they press.
- Deleting a day, a trip or the whole journal: not from here at all. Deleting a journal or a trip is asked for elsewhere and finishes in their email — the server sends a single-use link to a page with a button, and only that button deletes.
- Inviting somebody to read, or letting a fellow traveller write: the invite links on their journal's contacts page.

If they tell you something that happened — "I was in Lisbon", "we spent forty euros on lunch" — do not pretend to have written it down, because you have not. Say so in one sentence and point at where it goes. You may say what you understood, so they can carry it there.

WHAT YOU MUST NEVER DO

Never invent anything about their travels. No weather, no meal, no place, no person, no number that did not come from a tool or from what they told you. One invented memory presented to somebody's family as fact is not recoverable, and this journal is read by families. If you do not know, say you do not know.

Never write about the weather at all, whatever they ask. This journal records weather from a measured archive at the coordinates a day already carries, and a sentence of yours would compete with a measurement.

Never repeat back a location, an address or a coordinate as fact. You have no access to anybody's position history and must never claim to.

Never make up a tool, a page or a button that is not named above.

HOW TO WRITE

Short. Plain sentences, no lists unless they asked for one, no closing line summing up what their travels mean. Two or three sentences answers most questions. They are on a phone.`;
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
};

/**
 * One turn: the conversation so far, one new sentence, and a few tool calls.
 *
 * Throws only when the model itself fails — the route answers `502` and the
 * person's own words are still in the box. A tool that fails is not a failure
 * of the turn: `runTool` hands the model a value it can read, and the answer
 * is a sentence about it.
 */
export async function answerInThread(
  username: string,
  said: string,
  turns: Turn[],
  today: string,
  say: Say,
): Promise<ThreadAnswer> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    ...turns.map((turn) => ({ role: turn.role, content: turn.text })),
    { role: "user" as const, content: said },
  ];
  const looked: string[] = [];
  const blocks: Block[] = [];
  const proposals: Proposal[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const response = await client.messages.create({
      model: HELPER_MODEL,
      max_tokens: THREAD_MAX_TOKENS,
      system: threadSystemPrompt(today),
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

    if (calls.length === 0) return { answer: text, looked, blocks, proposals };

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      looked.push(call.name);
      const { ok, result, block, proposal } = await runTool(username, call.name, call.input, say);
      if (block) blocks.push(block);
      if (proposal) proposals.push(proposal);
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
    system: threadSystemPrompt(today),
    messages,
  });
  await book(username, "ask_thread", last.usage);
  return {
    answer: last.content
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("")
      .trim(),
    looked,
    blocks,
    proposals,
  };
}
