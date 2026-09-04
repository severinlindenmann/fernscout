/**
 * The sentences more than one agent-facing document has to say.
 *
 * There are four doors onto the same API — `/documentation.txt`,
 * `/<user>/documentation.txt`, `/agent.md` and `/openapi.json` — and they are
 * deliberately different documents rather than one. The first two are
 * *indexes*, and the second of them is generated per journal, naming that
 * journal's own trips; the guide is the *manual* and is the same for everyone
 * on the instance; the OpenAPI file is the machine contract. Merging them
 * would mean either handing an agent that asked "whose journal is this" 26 KB
 * of manual, or giving up the per-journal specificity that makes the small
 * documents worth reading. The llms.txt convention they follow is explicitly
 * an index that links to fuller documents.
 *
 * What that split does **not** license is saying the same thing four times in
 * four hand-written copies. AGENTS.md puts it plainly: a reference kept in two
 * files is a reference that disagrees with itself within a month, and this
 * project has already had that happen once, when the visibility vocabulary
 * changed in W27 and only one copy followed.
 *
 * So the *definitions* live here, once, and each document frames them in its
 * own voice and its own shape. This module is deliberately dependency-free —
 * `app/openapi.json/route.ts` imports it without dragging in the whole
 * documentation generator, and `test/agent-interface.test.ts` asserts that
 * every document actually carries them.
 */

/**
 * What a journal's `visibility` decides.
 *
 * Written as one sentence rather than a paragraph so it can be dropped into a
 * numbered list, a prose section and a JSON `description` without any of the
 * three needing to rephrase it.
 *
 * The word for the closed state is `guest`, not `private` — B306. This level
 * used to borrow the trip's `private`, and an owner asked which their journal
 * should be answered `guest` twice before an agent worked out that the two
 * questions meant different things: the trip's `private` is the narrowest of
 * three read-access values, and this one is only ever about being found.
 * `"private"` still parses here, forever, on a `config.json` nobody has
 * touched since before the rename — see `normalizeJournalVisibility` in
 * lib/config.ts — but this sentence is what an agent asking the question
 * should say, and it says the current word.
 */
export const VISIBILITY_MEANING =
  "public is listed on this server's own index, on its landing page and in its sitemap; " +
  "guest is on none of them and asks search engines not to index it — anyone sent the " +
  "address can still open it. It is also this journal's own answer for a new trip's " +
  "default, unless the create call says otherwise.";

/**
 * The half of it that gets misread, and the reason it must travel with the
 * sentence above wherever that goes: "private journey" sounds like a lock and
 * is not one. A person told otherwise will put something in it they should
 * not.
 *
 * It used to say a journey was gated by "a password, invited guests and the
 * trip's `people:` list", which listed one mechanism beside two audiences and
 * was wrong about the middle one from B41 onwards: a guest is a guest of the
 * *journal*, so `guest` is not a property of who was invited to that trip. The
 * distinction between the two closed values is the thing a person gets wrong
 * at the moment they create a trip, so it is what the sentence now spends its
 * words on.
 *
 * The final clause used to say a new trip is `private` whichever kind of
 * journal it is in — true before B306, and no longer: a new trip's default
 * now follows the journal's own answer, `public` in a `public` journal and
 * `guest` in a `guest` one, unless the create call says otherwise.
 */
export const VISIBILITY_NOT_A_LOCK =
  "Neither decides who may read a particular journey: that is the trip's own `visibility` " +
  "— `guest` means the people the owner has let into this journal, `private` means only " +
  "the people who were there, `public` means anyone — and a new trip's default follows " +
  "the journal's own answer, unless the call that creates it says otherwise.";

/**
 * The consequence of the slug rule, which the rule alone does not carry.
 *
 * "The slug comes from the title, and no two days in a trip may share one" is
 * already documented — this is what an agent titling several days from one
 * journal actually needs at that moment: a worked example of the fix, not
 * just the name of the failure mode. B292.
 */
export const TITLE_COLLISION_EXAMPLE =
  "Two days at the same place, titled the same way, collide: give each a distinguishing " +
  "title instead — `Bangkok — Arrival`, `Bangkok — Night Market`.";

/**
 * Where photographs actually go, named rather than left as "the media
 * endpoint" for an agent to guess at — it guessed `.../days/{slug}/photos`,
 * got a 404, and went hunting. B292.
 */
export const MEDIA_ENDPOINT_PATH = "/api/v1/<user>/trips/<trip-id>/media";

/**
 * The question nothing asked before B267: whether this trip accounts for its
 * money at all. `costs.md` is optional (AGENTS.md, the content model) and
 * `features.costs` is on by default at creation (lib/journals.ts), so a trip
 * ended up with the capability on and nobody ever having been asked for a
 * figure — the costs page rendered anyway, with nothing in it. Saying what
 * "yes" costs the person, and what "no" costs the page, is the fix: a
 * decision put to them instead of left to a default.
 *
 * B328 corrected the last clause: a `costs.md` was said to be the only thing
 * that brings the page, which stopped being true the day per-day `costs:`
 * became writable on a day itself (W38, B292) — a trip with fifteen costed
 * days and no `costs.md` had a page with nothing to show it.
 */
export const BUDGET_QUESTION =
  "Ask whether this trip tracks its money. Saying yes means a `costs.md` — a budget, and " +
  "a figure per day, both supplied by the person and never guessed at by you. That is one " +
  "way to bring a costs page onto the site, not the only one: a day carrying its own " +
  "`costs:` block does too, and either is enough for the page and its nav entry to appear.";

/**
 * What a day owes its journal's other languages — B294, corrected by B316.
 *
 * The complaint: a journal declaring `de`, `en` and `hu` gave a reader who
 * switched to English an English switcher, an English trip title, and German
 * prose. `translations` covered a trip's title and tagline and nothing else,
 * so no call could put a day's words in a second language.
 *
 * The owner chose to require them. B294's wording forbade translating
 * outright, on the theory that carrying words into another language is the
 * same invention as putting weather nobody mentioned into a day — it is not.
 * AGENTS.md's one rule is about *what happened*; translating what the owner
 * did write invents nothing. Stated as an absolute, the sentence trapped an
 * agent that had hit the refusal and was then asked, directly, to translate:
 * it complied "under protest", having read its own instructions as forbidding
 * the one thing that would satisfy them (B316). So the rule now turns on
 * whether the owner asked — silent translation is still the failure, asked-for
 * translation is not, and either way the day must say which words are whose.
 *
 * B326 added the clause naming which slot holds which language, after an
 * agent working from English prose for a `defaultLocale: de` journal put
 * English in the day's own `title`/`content` and German in
 * `translations.de` — backwards, and nothing here or in the refusal said so
 * until then.
 */
export const TRANSLATIONS_REQUIRED =
  "**`translations` — the day's title and content in the journal's other languages.** The " +
  "day's own `title` and `content` are the journal's `defaultLocale` version; `translations` " +
  "holds the rest, one entry per remaining language. A " +
  "journal readable in three languages writes its days in three: a day missing one is " +
  "refused, and the refusal names which. Send it as " +
  '`{"en": {"title": "…", "content": "…"}}`, keyed by language code, for every language ' +
  "the journal declares except the one the day is already written in. **Do not translate " +
  "unasked** — three language versions the owner never asked for, presented as their own " +
  "writing, is the failure. **If they ask you to, translate it**: carrying what they wrote " +
  "into another language invents nothing, and is not the invented weather or meals AGENTS.md " +
  "forbids. Say so in your reply either way, so the owner knows which words are theirs and " +
  "can correct them. If they write in one language only, the fix is the journal's " +
  "`locales`, not the day: one `PATCH` to the journal's config, and nothing is owed.";

/**
 * What is not writable, said once so nobody has to discover it by guessing.
 *
 * B293. An agent asked to turn a trip's costs page off tried `PATCH` on the
 * trip and on the journal, got a bare `405` from both, and then told its owner
 * to "do it manually via the web UI" — an interface that does not exist and
 * never will (ROADMAP decision 24). That is the same invention as B259's
 * "manually upload", and it comes from the same place: no correct call
 * available and nothing saying so.
 *
 * Two facts, and the first has stopped being a dead end. The costs page now
 * follows the data (B267) and the budget is writable (B295), so "turn it off"
 * has a real answer. `features` genuinely is not writable, and the reason is
 * worth carrying: `auth` and `contacts` gate the way back into a journal, and
 * a token issued because of an address must not be able to sever it — which is
 * why B153 forces both on at creation.
 */
export const NOT_WRITABLE =
  "Two things no call changes, so you do not have to look. A journal's `features` are not " +
  "writable through any door: `auth` and `contacts` are what get an owner back into their " +
  "own journal, and a token must not be able to shut the door it came through. And a trip " +
  "has no costs *switch* — the page follows the data, and the data is either a budget at the " +
  "costs endpoint or any day carrying its own `costs:` block. Write either and the page " +
  "appears; to take it away, both have to go — deleting the budget while the days still log " +
  "spend leaves the page exactly where it was (B332). If neither of those is what you were " +
  "asked for, say so and stop: there is no web form, no CMS and no upload page to send " +
  "somebody to instead.";

/**
 * The other question B267 found nothing asking: a day is written to hold
 * `lat`/`lng`, and nothing ever said so. Fifteen days went out with neither,
 * at which point there was no coordinate to add after the fact (B266) and no
 * reason for an agent reading a journal's prose to have thought they were
 * wanted.
 *
 * The line this sentence has to hold, deliberately: *propose*, do not invent.
 * An agent reading "we had lunch in Hoi An" may reasonably know where Hoi An
 * is and offer it — but only as something put to the person, never as
 * something written on the strength of its own guess. "An empty field beats
 * an invented location" is the same rule AGENTS.md states for every other
 * fact a day might carry, said again here because a weak model reading only
 * "propose coordinates" could otherwise read that as permission to geocode
 * and write in the same breath.
 */
// The seven categories, read from the definition rather than typed out here:
// an eighth would otherwise be listed everywhere except in the sentence that
// tells an agent which ones exist.
import { COST_CATEGORIES } from "../costFormat";

/**
 * One day with every field an agent should have asked for, filled in — B335.
 *
 * The two documents each carried a two-field example (`title`, `date`,
 * `content`), which is the *minimum* a day is refused for lacking and reads
 * as the *target*. An agent that copies it writes a day with no place on the
 * map, no money and no leg on the story pager, and every one of those is a
 * second call to fix later. Defined once and rendered by both documents so
 * the two cannot drift.
 *
 * `status` and `gallery` are absent because they are not fields: a day is
 * always a draft, and photographs are their own call.
 */
export const PERFECT_DAY_EXAMPLE = [
  "{",
  '  "title": "Lanterns of Hoi An",',
  '  "date": "2026-08-26",',
  '  "time": "16:45",',
  '  "location": "Hoi An",',
  '  "country": "Vietnam",',
  '  "lat": 15.8801,',
  '  "lng": 108.338,',
  '  "transportMode": "bus",',
  '  "transportFrom": "Da Lat",',
  '  "transportTo": "Hoi An",',
  '  "content": "The whole old town hangs with lanterns...",',
  '  "tags": ["vietnam"],',
  '  "costs": [',
  '    {"label": "Sleeper bus", "amount": 320000, "currency": "VND", "category": "transport"},',
  '    {"label": "Dinner", "amount": 180000, "currency": "VND", "category": "food"}',
  "  ],",
  '  "idempotency_key": "one-key-per-day-you-write"',
  "}",
];

/**
 * What the example above is for — B335. Said in words, because a block of
 * JSON with no sentence over it reads as one of several shapes rather than
 * as the one to aim at.
 */
export const PERFECT_DAY_INTRO =
  "This is what a finished day looks like — the shape to aim at, not the minimum. Only " +
  "`title`, `date` and `content` are required; everything else here is a question worth " +
  "asking, because each one omitted is something the site cannot show and a second call " +
  "to correct later. Send what you were actually told and leave the rest out: an empty " +
  "field beats an invented one, and this example is a form to fill from what the person " +
  "said, never a set of plausible values to copy.";

/**
 * What a day's spending owes, before it is written — B335.
 *
 * `dayQuestions()` asked about coordinates and never about money, so `costs`
 * was the field an agent simply did not think of: the validator
 * (`checkCosts`, lib/validate/entry.ts) is strict about it and only ever got
 * to say so to the callers that had guessed the field existed.
 *
 * The three refusals worth naming ahead of the write are the ones whose
 * failure is silent if they are not caught here — a zero amount and an
 * unrecognisable currency were both stored and then dropped when the page
 * rendered, before B304, and a currency the trip has no rate for is still
 * reported unconverted rather than counted wrong.
 */
export const DAY_MONEY_QUESTION =
  "Ask what the day cost, and record each thing separately rather than as one total: " +
  "`costs: [{label, amount, currency, category}]`. `label` and `amount` are required, and " +
  "the amount is a positive number — zero or less is refused. **The currency is the one " +
  "the money was actually spent in**, as three letters (`VND`, not `\u20ab` and not the " +
  "converted figure); nothing is converted on the way in, and a currency this trip's " +
  "`rates:` block does not carry is reported unconverted rather than guessed at. Omitting " +
  "`currency` means the journal's base currency, so omit it only when that is true. " +
  "`category` is one of " + COST_CATEGORIES.join(", ") + ". Amounts are the person's to " +
  "state: an approximate figure they gave you is fine, one you inferred from what things " +
  "usually cost is not.";

export const COORDINATES_QUESTION =
  "A day is expected to carry `lat` and `lng` — they are what puts it on the map, and a " +
  "day written without them is a day the map cannot show. Ask for them, and where the " +
  "prose you are working from names a real place, propose coordinates for the person to " +
  "confirm rather than leaving the field empty. An unconfirmed guess is never written: an " +
  "empty field beats an invented location.";

/**
 * What follows a trip's days, once they exist — B317.
 *
 * Every day script already says a single day arrives as a draft and asks the
 * person before publishing it. What none of it said was the moment that
 * matters once several days of a trip are sitting there: nothing prompted an
 * agent to go back and offer to put them up. This is that offer, not a new
 * rule — AGENTS.md's "ask, in words, and wait" already governs every call it
 * describes, which is why this is phrased as one to make, not one to
 * default to.
 */
export const PUBLISH_OFFER =
  "Once a trip's days are written, say so plainly: they are still only drafts, and nothing " +
  "is on the site yet. Then offer to publish — one call per day, and the owner's decision " +
  "every time, never assumed because a day merely looks finished.";

/**
 * What follows a trip going live — B317.
 *
 * An owner with a freshly published trip has no reason to know
 * `POST /api/v1/<user>/invites` exists; this is the sentence that tells an
 * agent to offer it, once. Deliberately silent on *how* the link then
 * reaches the person it is for: B319 is adding a mailed invitation in the
 * recipient's own language, and pre-approval, on top of this same call —
 * this sentence describes what the link is and that the owner may want it
 * sent, and stops there, so B319's mechanism is an answer to "how" rather
 * than a rewrite of this offer.
 */
export const GUEST_LINK_OFFER =
  "Once a trip is published, offer a guest link — `POST /api/v1/<user>/invites` with " +
  '`{"kind": "guest"}`. Say what it is: leads to reading the journal\'s `guest` trips, safe ' +
  "to forward, and grants nothing until the owner approves whoever opens it. Ask whether " +
  "they want one sent.";

// Read from the constant rather than typed into prose: a fourth language would
// otherwise be maintained everywhere except in the sentence that tells an agent
// it exists. The media limits table already works this way.
import { LOCALE_LABEL, MAINTAINED_LOCALES } from "../i18n";

/**
 * The maintained languages, named the way a person recognises them —
 * "Deutsch", not "de" — with the code beside each for the field that actually
 * takes it. B256: a bare `en, de, hu` was the only place either language
 * question named the choices, and it named them in a way only the software
 * understood.
 */
export const LOCALE_LIST = MAINTAINED_LOCALES.map(
  (code) => `${LOCALE_LABEL[code]} (\`${code}\`)`,
).join(", ");

/** One thing an agent has to ask before its first call. */
export type FirstQuestion = { ask: string; because: string };

/**
 * "Four questions", not "4 questions".
 *
 * The count comes from the list's own length so that adding a question cannot
 * leave the sentence above it lying — but a bare digit in running prose reads
 * like a form field. Only as far as the list could plausibly grow.
 */
const NUMERALS = ["no", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];
export function numeral(n: number): string {
  return NUMERALS[n] ?? String(n);
}

/**
 * `ask` and `because` as one sentence, for the documents that render the list
 * as prose rather than as a table.
 *
 * The join is a full stop unless `ask` already ends in punctuation — "Public or
 * private?." is the kind of seam that makes a generated document look
 * generated. Trailing markdown emphasis is looked past to find that
 * punctuation: the question mark in `**Public or guest?**` is real, and the
 * asterisks after it are not characters a reader sees.
 */
export function asSentence(question: FirstQuestion): string {
  const ask = question.ask.trimEnd();
  const joiner = /[?!.:][*`_]*$/.test(ask) ? "" : ".";
  return `${ask}${joiner} ${question.because}`;
}

/**
 * The questions to put to the person before anything else.
 *
 * Every one of them decides something they live with, and none has a default
 * worth guessing. An agent may arrive at either `/documentation.txt` or
 * `/agent.md` first, so both carry these — but as one list rendered twice, a
 * numbered list in the index and a table in the guide, rather than two lists
 * that will drift.
 *
 * Takes the site URL because the second question is about a URL.
 */
export function firstQuestions(siteUrl: string): FirstQuestion[] {
  return [
    {
      ask: "Their **email address**",
      because:
        "It is the only address that can ever get a token for this journal. Not a " +
        "preference — the credential.",
    },
    {
      ask: "The **journal's address** (`username`), if they have no journal yet",
      because:
        `It becomes ${siteUrl}/<username>, it is permanent, and it **is the journal's own ` +
        "name — never a trip's** — in lowercase letters, digits and dashes. Never invent " +
        "one, and never illustrate it either: an example inside the question you ask is a " +
        'suggestion, and "asia-2025" is a trip\'s name that somebody would be stuck with as ' +
        "their journal's address.",
    },
    {
      ask: "**Public or guest?** (`visibility`)",
      because: `Whether this server advertises the journal at all — ${VISIBILITY_MEANING}`,
    },
    {
      ask: "Their **name** (`ownerName`), and **what the site should call them** (`ownerNickname`)",
      because:
        "Two separate fields, asked, never inferred — an agent that infers the second from " +
        "the first is exactly the mistake these exist to stop. Splitting the first word off " +
        "a name is wrong for anyone whose given name is not first, and this holds even when " +
        "the person in front of you *is* the owner and just told you their name: ask the " +
        "second question too, in the form \"what should the site call you?\".",
    },
    {
      ask: "**Which language** they write in",
      because:
        `This instance maintains ${LOCALE_LIST}. It sets the language of the site's own ` +
        "chrome and of the mail this server sends the owner — including the letter that " +
        "arrives the moment the journal is created, which is the first thing the software " +
        "ever says to them. Send it as `defaultLocale`.",
    },
    {
      ask: "**Which languages a reader may switch the journal into**",
      because:
        "A different question from the one above — their own language is not necessarily " +
        `everyone their audience reads in. Choose from the same ${LOCALE_LIST}, including ` +
        "`defaultLocale` itself, and send it as `locales`, e.g. `[\"de\", \"en\"]`. Required " +
        "— a journal created without it has no language switcher at all, which is how one " +
        "asked for three languages ended up with one (B277). **Tell them what the answer " +
        "commits them to**: every day of every trip is then written in all of them, in " +
        "their own words, and a day missing one is refused (B294). Two languages is a " +
        "promise to write everything twice; if they are not going to, one is the honest " +
        "answer and it can be widened later.",
    },
  ];
}

/**
 * The sentence a table of questions never said: that it is a script.
 *
 * B307 — an agent that read the six questions above still asked them in three
 * separate rounds, interleaved with three fetches of the guide, because
 * nothing on the page told it these were one thing to do once rather than
 * six facts to pick up as they came to mind. This is that sentence, shared by
 * all three scripts below so it cannot say something different for one of
 * them.
 */
export function scriptIntro(count: number): string {
  return (
    `This is a script, not a menu: ask all ${numeral(count).toLowerCase()} of the questions ` +
    "below, in order, once, before your first call. Do not start on a guess."
  );
}

/**
 * Ask before creating a trip — B307.
 *
 * `id`, `title`, `start` and `end` are what `createTrip` (lib/tripWrite.ts)
 * requires; `visibility` and the budget question are not retyped here — they
 * reuse `VISIBILITY_CHOICE` and `BUDGET_QUESTION`, the same sentences the
 * rest of this file already exports, so there is one definition of each and
 * this script is a third *shape* for it, not a third *copy*.
 */
export function tripQuestions(): FirstQuestion[] {
  return [
    {
      ask: "The trip's **id** (`id`)",
      because:
        "Lowercase letters, digits and dashes, starting with a letter or digit. It becomes " +
        "part of the URL and cannot be changed afterwards — `japan-2027` ages better than " +
        "`the-big-one`.",
    },
    {
      ask: "Its **title** (`title`)",
      because: "What the trip is called. Required — a trip without one is refused.",
    },
    {
      ask: "**When it starts and ends** (`start`, `end`)",
      because:
        "Both, as `2027-04-01`. Required: a trip missing either is skipped when the site " +
        "reads it, so it would exist on disk and nowhere a reader could find it.",
    },
    {
      ask: "**Public, guest or private?** (`visibility`)",
      because:
        `${VISIBILITY_CHOICE} Leaving it out is not a fourth answer: the trip then inherits ` +
        "this journal's own answer, never wider than that, and a value this server does not " +
        "recognise falls back to `private` instead, the narrowest state there is.",
    },
    {
      ask: "**Does this trip track its money?**",
      because: BUDGET_QUESTION,
    },
  ];
}

/**
 * Ask before writing a day — B307.
 *
 * `title`, `date` and `content` are required by `validateEntry`
 * (lib/validate/entry.ts). `translations` becomes required the moment the
 * journal declares more than one language (B294) and reuses
 * `TRANSLATIONS_REQUIRED` rather than saying it twice; coordinates never are
 * — `COORDINATES_QUESTION` already says to propose, never invent, so it
 * stays a question rather than a requirement.
 */
export function dayQuestions(): FirstQuestion[] {
  return [
    {
      ask: "The day's **title** (`title`)",
      because:
        "Required — it becomes the slug, and no two days in a trip may share one; a title " +
        "that collides is refused rather than overwriting the day already there.",
    },
    {
      ask: "The **date** (`date`)",
      because: "Required, as YYYY-MM-DD — a real calendar date.",
    },
    {
      ask: "**What happened, in their words** (`content`)",
      because:
        "Required — the day's prose, as they told it. Write what you were told: no invented " +
        "weather, meals or feelings. An empty field beats a plausible fiction.",
    },
    {
      ask: "**The same day in the journal's other languages** (`translations`)",
      because: TRANSLATIONS_REQUIRED,
    },
    {
      ask: "**Coordinates**, if the prose names a real place (`lat`, `lng`)",
      because: COORDINATES_QUESTION,
    },
    {
      ask: "**What the day cost** (`costs`)",
      because: DAY_MONEY_QUESTION,
    },
  ];
}

/**
 * The note a day script owes and a question list cannot carry: photographs
 * are not a field on the call above, they are a call of their own, made once
 * the day exists — B307, closing the "Writing a day" bullet the ticket asked
 * for.
 *
 * B317 added the second sentence. A day script that only named the endpoint
 * still left an agent to fetch the guide for the field names before it could
 * act — `multipart/form-data`, `day`, `files`, all one line away in
 * `app/api/v1/[user]/trips/[trip]/media/route.ts` — and the transcripts this
 * ticket came from show an agent that had just written a day with photos
 * described to it, and did not think to ask for them. The coordinates clause
 * beside it is the same gap: `COORDINATES_QUESTION` asks before the day is
 * written, but an owner who answered "I don't know" or was never asked — an
 * older flow, a day imported some other way — still has a real place sitting
 * in the prose with nothing on the map for it.
 */
export const PHOTOS_SECOND_CALL =
  "Photographs are never part of this call. They are a second one, once the day exists — " +
  `offer it, naming the call: ${MEDIA_ENDPOINT_PATH}, sent as \`multipart/form-data\` with ` +
  "`day` (the slug) and `files` (the bytes). There is nothing to paste into the entry " +
  "itself. Offer coordinates too, if the day names a real place and carries no `lat`/`lng` " +
  "yet — the same `PATCH` the day itself takes, not a new call.";

/**
 * Greedy wrap to a column, for the documents that are assembled as arrays of
 * lines and hand-wrapped at 78.
 *
 * A constant pasted into one of those unwrapped is a 200-character line in a
 * file whose whole point is being read as plain text.
 */
export function wrap(text: string, width = 78, indent = ""): string[] {
  const out: string[] = [];
  let line = indent;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line === indent ? indent + word : `${line} ${word}`;
    if (candidate.length > width && line !== indent) {
      out.push(line);
      line = indent + word;
    } else {
      line = candidate;
    }
  }
  if (line !== indent) out.push(line);
  return out;
}

/**
 * The prompt an owner pastes into an agent — B283.
 *
 * Written here rather than in the component that renders it, and in **English
 * regardless of the owner's locale**, because the reader is an agent and every
 * other agent-facing document on this instance is English: `/agent.md`,
 * `/documentation.txt`, the `next` line on every API response. A German owner
 * sees German chrome around it, which is the two-layer split in AGENTS.md §1.2
 * working as designed — the UI is translated, the content is in whatever
 * language it was written in, and this is content addressed to a machine.
 *
 * Three instructions and nothing else, in the order they have to happen. It is
 * deliberately not a summary of the guide: an agent that follows step 3 has the
 * guide, and a prompt that tried to teach the API would be stale the first time
 * the API changed.
 *
 * The credential is on its own line so that a person can see what they are
 * handing over, and the expiry is beside it so they can see it is short.
 */
export function handoverPrompt(input: {
  siteUrl: string;
  username: string;
  handover: string;
  minutes: number;
}): string {
  const { siteUrl, username, handover, minutes } = input;
  return [
    `You are writing for a Fernscout travel journal that already exists: ${siteUrl}/${username}`,
    "",
    `1. Exchange this key for your own 7-day token. It works once, for ${minutes} minutes:`,
    "",
    `   curl -X POST ${siteUrl}/api/auth/handover \\`,
    `     -H "Authorization: Bearer ${handover}"`,
    "",
    "2. Then, before anything else, read where the journal stands:",
    "",
    `   GET ${siteUrl}/api/v1/${username}/status`,
    "",
    "   It says what is waiting for approval, which trips you may write to, and",
    "   what this server can do. Do not write until you have read it.",
    "",
    `3. The full guide is at ${siteUrl}/agent.md — deleting, photographs, letting`,
    "   people in, and a worked example of each.",
    "",
    "Everything you write arrives as a draft. Putting a day on the site is a",
    "second call, and it is mine to ask for — never publish because something",
    "looks finished. Write what I tell you and nothing I did not.",
  ].join("\n");
}

/**
 * Which visibility to give a new trip — B302.
 *
 * `VISIBILITY_NOT_A_LOCK` above *defines* the three values and is carried by
 * every agent-facing document. This is the different question, and the one an
 * agent actually has to put to a person: which of the three to ask for. The
 * guide had no answer to it. It said "a trip is created private unless you say
 * otherwise; ask before sending public" — a binary, in which the value that
 * matches "my family should be able to read this" is never mentioned at all.
 * So an agent asked "shall I make it public?", heard "no", and left a `private`
 * trip; and the owner then approved a guest who could not read it. That is
 * B300, and this is the sentence whose absence caused it.
 *
 * Three things have to hold at once without contradicting each other, which is
 * why this is one constant rather than three:
 *
 * - **the default follows the journal** — `public` in a `public` journal,
 *   `guest` in a `guest` one (B306), never wider than that, and a
 *   misspelled value still falls back to `private`, the narrowest state
 *   there is;
 * - **do not rely on the default** — ask, and recommend `public` or `guest`;
 * - **`private` is the narrow tool**, for one journey held back from readers
 *   who are welcome to the rest.
 *
 * The order is the author's (2026-09-04): public, guest, private — most open
 * first, because that is the order a person decides in.
 */
export const VISIBILITY_CHOICE =
  "Ask which of three, and say what each does. **`public`** — anyone with the address, and " +
  "listed in this journal's feed and sitemap. **`guest`** — the people the owner has " +
  "approved into this journal, plus anyone named on the trip; nobody else, and it is never " +
  "advertised. **`private`** — only the people named on the trip, and *not* the journal's " +
  "approved guests. Recommend `public` or `guest`: those are what somebody keeping a journal " +
  "for people actually wants, and `private` is the narrow tool for holding one journey back " +
  "from readers who may read the rest.";

/**
 * The consequence that the definitions alone do not carry, and the one an
 * owner walked into on the live site — B300.
 *
 * It travels with `VISIBILITY_CHOICE` wherever that goes. Approving a guest is
 * a grant on the *journal*, and a `private` trip does not honour it: the owner
 * sees "approved", the reader sees a locked page, and no amount of approving
 * changes it. Whoever reads this is the only party in a position to say so
 * before the trip is created.
 */
export const PRIVATE_SHUTS_OUT_GUESTS =
  "A `private` trip stays shut to approved guests too — approving somebody into the journal " +
  "does not open it, and the owner has no way to grant it per person. If the plan is to " +
  "share with family, `guest` is the value, and approving them is the other half of it.";

/**
 * The same choice, for `visibility` on a field list rather than in prose.
 *
 * Short enough for an OpenAPI `description`, where the paragraph above would
 * be a wall. Both come from here so the two cannot drift.
 *
 * Used to say "omitted means private, so a forgotten field publishes
 * nothing" — true before B306, when a trip's default did not look at its
 * journal at all. It now does, so the safe half of that sentence has to be
 * said differently: a forgotten field is never wider than the journal it is
 * in, not always closed.
 */
export const VISIBILITY_ENUM_NOTE =
  "public (anyone, and listed) · guest (the journal's approved guests, plus the trip's own " +
  "people) · private (only the trip's own people, not approved guests). Omitted means this " +
  "journal's own answer — public in a public journal, guest in a guest one — so a " +
  "forgotten field is never wider than the journal already is; a value this server does " +
  "not recognise falls back to private instead. Ask rather than relying on either, and " +
  "recommend public or guest.";

/**
 * Shell-safe single quoting, for the JSON bodies in the prompt below.
 *
 * The prompt carries a person's own email address inside a `curl -d '…'`, and
 * an apostrophe in a local part — `o'brien@example.test` is a real address —
 * would otherwise end the quoting and hand somebody a command that fails in a
 * way they have no reason to understand. Three lines, once, rather than a
 * caveat nobody reads.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The prompt somebody on a trip pastes into an agent — B320.
 *
 * The owner's equivalent is `handoverPrompt`, and this is deliberately **not**
 * that. `issueHandover` refuses anybody but the owner, on purpose
 * (lib/auth/index.ts) — a handover credential is exchanged for a token whose
 * scope is the whole journal, and a buddy's write access is one trip. So this
 * prompt drives the flow that was already built for exactly this person: an
 * agent code bound to a trip (B230), redeemed for a token that
 * `tripWriteScope` narrows to it.
 *
 * The consequence for the shape of the prompt is the step in the middle: the
 * code is mailed to the buddy, not printed on the page, so the agent has to
 * ask and the person has to read six digits across. That is a worse experience
 * than the owner's button and it is the honest one — printing a credential
 * here would mean minting a journal-wide one first.
 *
 * English regardless of the reader's locale, for the reason `handoverPrompt`
 * gives: the reader is an agent, and every agent-facing document on this
 * instance is English.
 *
 * The last paragraph is not decoration. A buddy's token cannot publish, and an
 * agent that does not know that will read a refusal as a fault and go looking
 * for another way — which is the failure mode B293 recorded, where "no correct
 * call available and nothing saying so" ended in an invented web UI.
 */
export function buddyPrompt(input: {
  siteUrl: string;
  username: string;
  tripId: string;
  email: string;
}): string {
  const { siteUrl, username, tripId, email } = input;
  const request = JSON.stringify({ user: username, email, kind: "agent", trip: tripId });
  const verify = JSON.stringify({ user: username, email, kind: "agent", code: "<the six digits>" });
  return [
    `You are writing one trip in a Fernscout travel journal: ${siteUrl}/${username}/trips/${tripId}`,
    "",
    "1. Ask for a code. It is emailed to me, and I will read it to you — this",
    "   call tells you nothing on its own:",
    "",
    `   curl -X POST ${siteUrl}/api/auth/request \\`,
    `     -H "content-type: application/json" \\`,
    `     -d ${shellQuote(request)}`,
    "",
    "2. Exchange the six digits for your own 7-day token. The trip was decided",
    "   when the code was issued, so there is nothing more to name here:",
    "",
    `   curl -X POST ${siteUrl}/api/auth/verify \\`,
    `     -H "content-type: application/json" \\`,
    `     -d ${shellQuote(verify)}`,
    "",
    "3. Then, before anything else, read where the journal stands:",
    "",
    `   GET ${siteUrl}/api/v1/${username}/status`,
    "",
    `4. The full guide is at ${siteUrl}/agent.md — writing a day, photographs,`,
    "   and a worked example of each.",
    "",
    `Your token writes days into ${tripId} and nothing else in this journal.`,
    "It cannot put a day on the site: everything you write stays a draft until",
    "the person whose journal this is asks for it, and that call is theirs and",
    "not mine. Write what I tell you and nothing I did not — no weather I did",
    "not mention, no meals I did not eat.",
  ].join("\n");
}
