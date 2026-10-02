import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MAINTAINED_LOCALES } from "../i18n";
import { renderDayPack, packText, type DayPack } from "./dayContext";
import { book } from "./model";
import { modelFor } from "./models";
import {
  BANNED_PHRASES,
  STORY_FLOOR_WORDS,
  STORY_MIN_SEEN,
  STORY_MIN_WORDS,
  checkVariant,
  keptTitles,
  ownerWordCount,
  sentencesOf,
  variantText,
  type ComposeVariant,
  type GuardContext,
  type GuardItem,
  type TitleKind,
} from "./composeGuard";

/**
 * The day composer — B2688. One day's real context in (the pack from
 * `buildDayContext`, B2687), a grounded entry out in two variants: `close`
 * (the owner's own words, tidied) and `story` (the same material told as a
 * short entry, or null when the notes are too thin to tell).
 *
 * Every sentence names the pack ids it rests on, which is what lets
 * `composeGuard.ts` check a sentence against its *own* sources rather than
 * guess. A variant that fails a guard is dropped; a banned phrase gets one
 * retry with the phrases named; both variants gone is `ComposeRejected`,
 * which the route answers with 422 and no AI day.
 *
 * Nothing here writes anything. The owner reads the proposal and keeps it,
 * edits it or throws it away.
 */

const BANNED_LINES = Object.entries(BANNED_PHRASES)
  .map(([lang, phrases]) => `  ${lang}: ${phrases.join(", ")}`)
  .join("\n");

/** Frozen, positive, reasons with rules, examples before the task. Cached
 *  (`cache_control`) — the same text for every journal, so every call after
 *  the first reads it at a tenth of the price. No owner data in here. */
export const COMPOSE_SYSTEM_PROMPT = `You help one person turn their own notes about one day of a trip into a short entry for their travel journal. The readers are their family and friends, who follow the trip from home and want to hear it in the writer's own voice. The writer will read what you propose next to their notes and keep it, edit it or throw it away. Nothing you write is saved on its own.

What a good entry is: it reads like the writer on a good day — their phrases kept, their order of importance kept, one or two concrete details a reader can see, and an ending that simply stops when the day's material stops. It is short when the notes are short.

THE TRUTH RULE — it outranks everything here, including making the entry better. Every factual detail must come from the <day_pack>. A detail is anything a reader could believe happened: a place, a person, an action, a food, a time, a number, the weather, a feeling. If the pack does not say it, you do not write it. Why: the entry is published under the writer's name to people who were not there; an invented detail is a lie told in their voice. You may connect, order, compress and phrase. You may not add.
- The writer's feelings are theirs to state. Keep the ones in the notes; never add a mood.
- <photo kind="seen"> describes what a picture shows, not what anyone did. You may mention what was seen; never turn a photo into an action unless a note says so.
- camera_time is the camera clock, never an activity time. Write a clock time only if a note gives it.
- Measured weather may be stated plainly with no hedging. The writer's own memory of weather stays too.
- "we" only if party_size is more than 1 or the notes use it; otherwise follow the writer's own person.
- <voice_samples> show how this person writes. Nothing in them happened today. Borrow rhythm and register, never content or names.
- Neighbouring days are context for the trip's arc. Never retell them as today.
- A plan, a wish or a condition in the notes ("if it rains we carry on", "we want to see") stays a plan. Never write how it turned out unless a note says so.
- Names, numbers and units in a sentence are checked by code against the items that sentence cites. Cite every item a sentence takes a name, number, time or fact from: a sentence naming the day's place cites place, one giving a temperature cites weather, one describing a photo cites that photo. A sentence that cites nothing may only connect; it carries no detail of its own.
- List in "names" every proper name, place, person, brand and number the sentence writes, exactly as written. Code checks each one against the sentence's sources.

Language: write in the language of the notes (normally the journal language). Keep names, dishes and quoted words as the writer wrote them. Say plainly what happened; when a literal word is available, use it. Readers recognise these words as machine-written, so use them only when the same word is in the notes:
${BANNED_LINES}
No rhetorical questions, no closing line about what the day meant.

Output, in this order:
1. used: the pack ids you will build on, most important first. Decide this before writing.
2. close: the writer's own words, tidied — spelling, punctuation, accents restored only where unmistakable, fragments joined where the subject is already in the notes. Every note stays in the language it was written in: never translate a note, even when the notes mix languages. Nothing from photos, weather or place goes into close. Nearly every sentence cites a note id. About as long as the notes.
3. story: the same material told as a short entry — an opening that drops the reader into the day, details in an order that carries, an ending that stops. At most about three times the notes' length. Many writers note only a line and let the photos tell the day: when the notes are short but three or more photos are described, the story may also say what those photos show — as seen, never as something anyone did — in at most about 60 words, with the writer's line kept as written. Pick the two to four photos that tell the day best, not all of them, and weave what they show into the writer's line as short, concrete scene details ("Nachtschlitteln mit Stirnlampen, auf einem verschneiten Weg durch den Wald."). Never frame it as "on the photos" or "in one picture", and leave out light, colours and camera angles unless they are the point. Measured weather may be one short clause; never more than one sentence about it. Return null when there is nothing to tell beyond the notes (short notes and fewer than three described photos): a story built on one line is padding.
4. Each sentence lists sources: the pack ids it rests on.
5. titles: up to two per variant, kind label (pack nouns) | quote (a phrase lifted word for word from the notes) | pair (two things from the day joined). Prefer a quote when the notes have a vivid phrase. Every word of a title is in the pack.
6. tags: up to 6 lowercase hyphenated English slugs naming an activity, a kind of place, a food, a way of travelling or a plain topic actually in the day ("hiking", "street-food", "rain"); reuse <existing_tags> first.
7. missing: up to three short questions, in the writer's language, for details only they know that would make the entry better. Ask; never state what happened or what you left out.

<examples note="format and judgement only; never reuse their content">
<example name="thin note: story is null">
<day_pack>
  <journal language="en" language_name="English" party_size="1"/>
  <fact id="date" kind="owner">2023-06-03, day 4 of 12</fact>
  <fact id="place" kind="owner">Ljubljana, Slovenia</fact>
  <notes>
    <n id="n1" kind="owner">train to ljubljana, slept most of it</n>
  </notes>
</day_pack>
{"language":"en","used":["n1"],"close":{"titles":[{"text":"Train to Ljubljana","kind":"label","sources":["n1"]}],"paragraphs":[{"sentences":[{"text":"Train to Ljubljana, slept most of it.","names":["Ljubljana"],"sources":["n1"]}]}]},"story":null,"tags":["train"],"missing":[{"question":"Anything you saw from the window?","about":"moment"}]}
</example>

<example name="rich German notes: close against story, a measured fact, a seen photo">
<day_pack>
  <journal language="de" language_name="Deutsch" party_size="2"/>
  <fact id="date" kind="owner">2022-10-12, day 3 of 9</fact>
  <fact id="place" kind="owner">Triest, Italien</fact>
  <fact id="weather" kind="measured" source="Open-Meteo">14–19°C, rain</fact>
  <notes>
    <n id="n1" kind="owner">mit dem bus nach miramare, das schloss war zu wegen renovation.</n>
    <n id="n2" kind="owner">dafür im park gesessen bis der regen kam.</n>
    <n id="n3" kind="owner">abends fischsuppe bei nonna rosa, beste bisher, 14 euro</n>
  </notes>
  <photo id="p1" kind="seen" camera_time="11:40">Ein weisses Schloss auf einem Felsen über grauem Meer</photo>
</day_pack>
{"language":"de","used":["n1","n3","n2","p1","weather"],"close":{"titles":[{"text":"Beste bisher","kind":"quote","sources":["n3"]}],"paragraphs":[{"sentences":[{"text":"Mit dem Bus nach Miramare, das Schloss war wegen Renovation zu.","names":["Miramare"],"sources":["n1"]},{"text":"Dafür im Park gesessen, bis der Regen kam.","names":[],"sources":["n2"]},{"text":"Abends Fischsuppe bei Nonna Rosa, die beste bisher, 14 Euro.","names":["Nonna Rosa", "14"],"sources":["n3"]}]}]},"story":{"titles":[{"text":"Miramare und die Fischsuppe","kind":"pair","sources":["n1","n3"]}],"paragraphs":[{"sentences":[{"text":"Das Schloss Miramare war wegen Renovation zu.","names":["Miramare"],"sources":["n1"]},{"text":"Weiss auf seinem Felsen über dem grauen Meer, und nur von aussen zu sehen.","names":[],"sources":["p1","n1"]},{"text":"Dafür sassen wir im Park, bis der Regen kam, bei 14 bis 19°C.","names":["14", "19"],"sources":["n2","weather"]}]},{"sentences":[{"text":"Abends dann Fischsuppe bei Nonna Rosa: 14 Euro, und die beste bisher.","names":["Nonna Rosa", "14"],"sources":["n3"]}]}]},"tags":["castle","rain","seafood"],"missing":[{"question":"Was war in der Fischsuppe?","about":"food"}]}
Why: the close keeps the writer's fragments; the story reorders them and uses the photo only for what it shows. 11:40 is the camera clock, so no time is written. "wir" because party_size is 2.
</example>

<example name="a rejected sentence">
<day_pack>
  <journal language="en" language_name="English" party_size="1"/>
  <fact id="date" kind="owner">2021-05-20, day 2 of 6</fact>
  <notes>
    <n id="n1" kind="owner">Old town in the morning, then the ferry to the island at noon.</n>
  </notes>
</day_pack>
Rejected story sentence: "We wandered the cobbled lanes of the old town." — no source says wandering or cobbled lanes, and "we" with party_size 1 and notes that never say it.
Written instead: {"text":"Old town in the morning.","names":[],"sources":["n1"]}
</example>
</examples>`;

const SOURCES = { type: "array", items: { type: "string" } } as const;

const VARIANT_SCHEMA = {
  type: "object",
  properties: {
    titles: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, kind: { type: "string", enum: ["label", "quote", "pair"] }, sources: SOURCES },
        required: ["text", "kind", "sources"],
        additionalProperties: false,
      },
    },
    paragraphs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentences: {
            type: "array",
            items: {
              type: "object",
              properties: { text: { type: "string" }, names: { type: "array", items: { type: "string" } }, sources: SOURCES },
              required: ["text", "names", "sources"],
              additionalProperties: false,
            },
          },
        },
        required: ["sentences"],
        additionalProperties: false,
      },
    },
  },
  required: ["titles", "paragraphs"],
  additionalProperties: false,
} as const;

const MISSING_ABOUT = ["person", "place", "food", "moment", "feeling", "weather", "other"] as const;

/** Source ids are checked in code, not a schema enum — an enum per day would
 *  compile a new grammar per call and lose the grammar cache. */
export const COMPOSE_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", enum: [...MAINTAINED_LOCALES] },
    used: { type: "array", items: { type: "string" } },
    close: VARIANT_SCHEMA,
    story: { anyOf: [VARIANT_SCHEMA, { type: "null" }] },
    tags: { type: "array", items: { type: "string" } },
    missing: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "string" }, about: { type: "string", enum: [...MISSING_ABOUT] } },
        required: ["question", "about"],
        additionalProperties: false,
      },
    },
  },
  required: ["language", "used", "close", "story", "tags", "missing"],
  additionalProperties: false,
} as const;

type RawCompose = {
  language: string;
  used: string[];
  close: ComposeVariant;
  story: ComposeVariant | null;
  tags: string[];
  missing: { question: string; about: (typeof MISSING_ABOUT)[number] }[];
};

/** What a review UI shows: the text, and per sentence the ids (with their
 *  kind) it rests on, so each can be a chip. */
type ComposedVariant = {
  titles: { text: string; kind: TitleKind }[];
  text: string;
  sentences: { text: string; sources: { id: string; kind: GuardItem["kind"] }[] }[];
};

export type Composed = {
  language: string;
  close: ComposedVariant | null;
  story: ComposedVariant | null;
  tags: string[];
  missing: { question: string; about: string }[];
  dropped: string[];
};

/** Both variants failed their guards — the route's 422, with no AI day. */
export class ComposeRejected extends Error {
  constructor(readonly reasons: string[]) {
    super("compose: every variant failed its guards");
  }
}

const MAX_ANSWERS = 3;
/** composeGuard's length reason, "story: 97 words, at most 70". */
const LENGTH_REASON = /words, at most (\d+)$/;

/** The pack with the owner's answers to earlier `missing` questions added as
 *  owner notes `a1`…`a3` — they are the writer's own words. */
function withAnswers(pack: DayPack, answers: string[]): DayPack {
  const extra = answers
    .slice(0, MAX_ANSWERS)
    .map((text, i) => ({ id: `a${i + 1}`, kind: "owner" as const, text: text.trim() }))
    .filter((a) => a.text !== "");
  return extra.length === 0 ? pack : { ...pack, notes: [...pack.notes, ...extra] };
}

/** Every citable item: `packText` minus voice samples, plus the two items
 *  `renderDayPack` renders that `packText` does not carry (trip, companions). */
function citable(pack: DayPack): GuardItem[] {
  const voiceIds = new Set(pack.voiceSamples.map((v) => v.id));
  const items = packText(pack).filter((i) => !voiceIds.has(i.id));
  items.push({
    id: "trip",
    kind: "owner",
    text: [pack.trip.title, pack.trip.tagline, pack.trip.dayIndex].filter(Boolean).join(" — "),
  });
  if (pack.trip.companions.length > 0) items.push({ id: "companions", kind: "owner", text: pack.trip.companions.join(", ") });
  return items;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Documents first, task last. */
function composeUserMessage(pack: DayPack, existingTags: string[]): string {
  return [
    renderDayPack(pack),
    `<existing_tags>${escapeXml(existingTags.join(", "))}</existing_tags>`,
    `<task>Write this day as described. Pack ids are the only facts. Decide "used" first.</task>`,
  ].join("\n");
}

async function callModel(message: string, owner: string): Promise<RawCompose> {
  const client = new Anthropic();
  const model = modelFor("compose");
  const response = await client.messages.create({
    model,
    max_tokens: 2500,
    thinking: { type: "disabled" },
    system: [{ type: "text", text: COMPOSE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: message }],
    output_config: { format: { type: "json_schema", schema: COMPOSE_SCHEMA } },
  });
  // The existing `write_day` bucket: the row carries the model id, so the
  // per-user ledger prices a Sonnet call as Sonnet.
  await book(owner, "write_day", response.usage, model);
  if (response.stop_reason === "max_tokens") throw new Error("compose: answer cut off");
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return JSON.parse(text) as RawCompose;
}

function present(variant: ComposeVariant, titles: ComposeVariant["titles"], byId: Map<string, GuardItem>): ComposedVariant {
  return {
    titles: titles.slice(0, 2).map(({ text, kind }) => ({ text, kind })),
    text: variantText(variant),
    sentences: sentencesOf(variant).map((s) => ({
      text: s.text.trim(),
      sources: s.sources.map((id) => ({ id, kind: byId.get(id)!.kind })),
    })),
  };
}

/**
 * Compose one day. Throws `ComposeRejected` when no variant survives, and
 * anything else (provider error, cut-off answer) as-is — the route maps the
 * first to 422 and the rest to 502, and records an AI day for neither.
 */
export async function composeDay(
  dayPack: DayPack,
  opts: { answers?: string[]; existingTags?: string[]; owner: string },
): Promise<Composed> {
  const pack = withAnswers(dayPack, opts.answers ?? []);
  const items = citable(pack);
  const byId = new Map(items.map((i) => [i.id, i]));
  const message = composeUserMessage(pack, opts.existingTags ?? []);
  const seen = items.filter((i) => i.kind === "seen").length;
  const photoTold = seen >= STORY_MIN_SEEN;
  const thin = ownerWordCount(items) < STORY_MIN_WORDS && !photoTold;

  const first = await callModel(message, opts.owner);
  const ctx: GuardContext = {
    items,
    voice: pack.voiceSamples.map((v) => v.text),
    date: pack.date,
    partySize: pack.journal.partySize,
    languages: [first.language, pack.journal.language],
    language: first.language,
    storyFloor: photoTold ? STORY_FLOOR_WORDS : 0,
  };
  const dropped: string[] = [];

  type Slot = "close" | "story";
  const judge = (raw: RawCompose, slot: Slot) => {
    const variant = raw[slot];
    if (!variant) return { variant: null, verdict: null };
    return { variant, verdict: checkVariant(ctx, variant, slot) };
  };

  const slots: Slot[] = thin ? ["close"] : ["close", "story"];
  if (thin && first.story) dropped.push(`story: notes under ${STORY_MIN_WORDS} words and under ${STORY_MIN_SEEN} described photos`);
  const results = new Map(slots.map((slot) => [slot, judge(first, slot)]));

  // One retry when the only thing wrong anywhere is a banned phrase.
  const bannedOnly = slots.filter((slot) => {
    const v = results.get(slot)!.verdict;
    return v && v.reasons.length === 0 && v.banned.length > 0;
  });
  if (bannedOnly.length > 0) {
    const phrases = [...new Set(bannedOnly.flatMap((slot) => results.get(slot)!.verdict!.banned))];
    const second = await callModel(`${message}\n\nRemove: ${phrases.join(", ")}`, opts.owner);
    for (const slot of bannedOnly) results.set(slot, judge(second, slot));
  }

  const out: Record<Slot, ComposedVariant | null> = { close: null, story: null };
  for (const slot of slots) {
    const { variant, verdict } = results.get(slot)!;
    if (!variant || !verdict) continue;
    let kept = variant;
    if (!verdict.ok) {
      // A story where one sentence in three or fewer failed only the
      // grounding checks loses those sentences, not the whole story: the
      // rest is still the owner's material, each sentence checked on its own.
      const sentences = sentencesOf(variant);
      const strikable =
        slot === "story" &&
        verdict.banned.length === 0 &&
        verdict.failing.length > 0 &&
        verdict.failing.length * 3 <= sentences.length &&
        verdict.reasons.every(
          (r) => LENGTH_REASON.test(r) || verdict.failing.some((i) => r.startsWith(`${slot}: "${sentences[i].text.slice(0, 60)}"`)),
        );
      const tooLongOnly = slot === "story" && verdict.banned.length === 0 && verdict.reasons.every((r) => LENGTH_REASON.test(r));
      if (!strikable && !tooLongOnly) {
        dropped.push(...verdict.reasons, ...verdict.banned.map((p) => `${slot}: banned "${p}"`));
        continue;
      }
      const strike = new Set(verdict.failing.map((i) => sentences[i]));
      kept = { ...variant, paragraphs: variant.paragraphs.map((p) => ({ sentences: p.sentences.filter((x) => !strike.has(x)) })).filter((p) => p.sentences.length > 0) };
      // Over the length cap: the story ends earlier — trailing sentences go
      // until it fits, never the opening one.
      const cap = Number(verdict.reasons.map((r) => LENGTH_REASON.exec(r)?.[1]).find(Boolean) ?? Infinity);
      while (sentencesOf(kept).length > 1 && variantText(kept).split(/\s+/).filter(Boolean).length > cap) {
        const last = kept.paragraphs[kept.paragraphs.length - 1];
        kept = { ...kept, paragraphs: [...kept.paragraphs.slice(0, -1), { sentences: last.sentences.slice(0, -1) }].filter((p) => p.sentences.length > 0) };
      }
      dropped.push(...verdict.reasons.map((r) => `struck: ${r}`));
    }
    const titles = keptTitles(ctx, kept.titles);
    dropped.push(...titles.reasons);
    out[slot] = present(kept, titles.titles, byId);
  }

  if (!out.close && !out.story) throw new ComposeRejected(dropped);
  return {
    language: first.language,
    close: out.close,
    story: out.story,
    tags: first.tags,
    missing: first.missing.slice(0, 3),
    dropped,
  };
}
