/**
 * The sentences more than one agent-facing document has to say.
 *
 * There are eleven doors onto the same API — `/documentation.txt`,
 * `/<user>/documentation.txt`, the nine task-sized guides at `/skill/*.md`
 * (B311) and `/openapi.json` — and they are deliberately different documents
 * rather than one. The first two are *indexes*, and the second of them is
 * generated per journal, naming that journal's own trips; the skill guides
 * are the *manual*, one per task, and the same for everyone on the instance;
 * the OpenAPI file is the machine contract. Merging the indexes with the
 * manual would mean either handing an agent that asked "whose journal is
 * this" a manual's worth of prose, or giving up the per-journal specificity
 * that makes the small documents worth reading. The llms.txt convention they
 * follow is explicitly an index that links to fuller documents — path
 * scoping is what turns "fuller documents" into "one per task" rather than
 * one enormous one; see the note in `lib/api/documentation.ts`.
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
 * documentation generator.
 *
 * v2 migration note (step 6, docs/v2-migration/03-build-order.md): the
 * fragments tied to the retired `agentGuide()` and index/question-script
 * prose — the perfect-day example, the frontmatter-migration table, the
 * question scripts for a trip and a day, and the sentences only they used
 * (`NOT_WRITABLE`, `TRANSLATIONS_REQUIRED`, `PUBLISH_OFFER`,
 * `GUEST_LINK_OFFER`, `COORDINATES_QUESTION`, `TITLE_COLLISION_EXAMPLE`,
 * `MEDIA_ENDPOINT_PATH`, `VISIBILITY_CHOICE`, `asSentence`, `scriptIntro`) —
 * were retired with this ticket: nothing outside `lib/api/documentation.ts`'s
 * own retired `agentGuide()` and the docs tests used them, and the v2 skill
 * docs (`lib/api/skillDocs.ts`) generate their field tables from the frozen
 * schemas instead of retyping an example.
 *
 * `PERFECT_TRIP_EXAMPLE` and `TRIP_FIELDS` are the one exception: they still
 * check a real thing about **v1**'s own `createTrip` (`lib/tripWrite.ts`) in
 * `test/trip-shape.test.ts` — a genuine contract test, not documentation
 * prose — so they stay, untouched, doing v1's job rather than v2's.
 *
 * What else remains here is genuinely shared: the journal-visibility
 * definitions (still true of a v2 journal), `firstQuestions()` (still asked
 * by the WhatsApp onboarding flow and the signup wizard), and the two
 * handover prompts (still rendered by the owner-facing components that paste
 * them into an agent).
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
 *
 * B856: it used to name "its sitemap" as one of the three places `public`
 * appears, and a tester who did not know what a sitemap was learned nothing
 * from the word. Named surfaces stop at the two anyone recognises; `guest`'s
 * half says what not being listed means instead of where it fails to appear.
 */
export const VISIBILITY_MEANING =
  "public is listed on this server's own index and on its landing page; guest is not " +
  "listed anywhere, and search engines are asked not to index it — anyone sent the " +
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
 * What a second reader language actually costs — B855.
 *
 * B838 put this on the signup form, where a person ticking a checkbox reads it
 * (`agent.readerLocalesHint` in `site/locales/*.json`, in all three languages,
 * because a person sees it). The API said nothing at all, and accepted
 * `["en", "de"]` in silence — so a tester picked a second language "because
 * German sounded like a normal extra option, not a leap" and found out at his
 * first day, which was refused until he produced a full German translation.
 * On a phone at 2am that is a landmine, not a question.
 *
 * So the sentence lives here and the agent-facing places read it: the `201`
 * from `POST /api/v2/journals`, and the OpenAPI description of the field
 * itself. Written to survive being dropped into either, which is why it names
 * the call rather than saying "this endpoint".
 */
export const SECOND_LANGUAGE_COMMITMENT =
  "**More than one entry in `locales` is a promise to write every day twice.** Every day of " +
  "every trip then has to exist in all of them, in the owner's own words: the day's own " +
  "`title` and `content` are the `defaultLocale` version and `translations` holds the rest. " +
  "A day missing one is refused — `POST .../days` answers `400` and names the language that " +
  "is missing — so this is not a preference that shows up later, it is a bill due at the " +
  "first day they write. One language is the honest answer for most people, and it can be " +
  "widened afterwards with a `PATCH` to the journal's config. Say this to them **before** " +
  "you send a second code, not after.";

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

/**
 * A finished v1 trip, for `test/trip-shape.test.ts` to POST at `createTrip`
 * (`lib/tripWrite.ts`) and read back — a v1 contract test, kept here because
 * this is where it always lived, not because a v2 document still reads it.
 * v1's own routes and `lib/api/openapi.ts` are frozen for this ticket, so
 * this example documents nothing that has changed.
 */
/**
 * One trip with every field a create call may carry — B530, and the same
 * finding B335 made about a day, one call earlier.
 *
 * Both documents showed `{id, title, start, end}` — the four fields
 * `createTrip` *refuses* a trip for lacking — as the example to copy, so the
 * other ten were invisible at the moment somebody was writing the call. A
 * trip made from that minimum has no tagline, no intro, no party, no rate
 * table and no answer about its money, and each of those is either a second
 * call later or, for `translations`, a field with no door at all.
 *
 * Two fields of `NewTrip` are deliberately not in these lines, and both are in
 * `TRIP_FIELDS` below instead:
 *
 * - **`test`**, because an example is a thing people copy and `"test": true`
 *   copied by accident puts a banner on somebody's real journey. It is the
 *   answer to "invent me a trip so I can see it work", and nothing else.
 * - **`cover`**, which is not a field here at all: a trip has no photographs
 *   at the moment it is created. It is named in the list because an agent
 *   reading a complete-looking example will otherwise go looking for it.
 */

/**
 * Fixed literal dates go stale: v2 derives a trip's status purely from
 * `start`/`end` against the real clock (`deriveStatus`, lib/trips.ts), so a
 * hardcoded "2027-04-01" reads as `upcoming` today and `past` a year from
 * now — either way not the `current` the surrounding prose demonstrates.
 * Anchored on today instead, the worked example stays true on the day it is
 * read rather than only on the day it was written.
 */
function isoDaysFromToday(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export const PERFECT_TRIP_EXAMPLE = [
  "{",
  '  "id": "japan-2027",',
  '  "title": "Japan",',
  '  "tagline": "six weeks by train",',
  `  "start": "${isoDaysFromToday(-15)}",`,
  `  "end": "${isoDaysFromToday(15)}",`,
  '  "status": "current",',
  '  "visibility": "public",',
  '  "listed": false,',
  '  "accent": "sky",',
  '  "costsVisibility": "guests",',
  '  "intro": "Six weeks from Kyushu to Hokkaido, mostly by rail.",',
  '  "people": [',
  '    {"name": "Ana Meyer", "email": "ana@example.test", "nickname": "Ana"}',
  "  ],",
  '  "travellers": [',
  '    {"for": "ana@example.test", "skin": "medium", "hair": "black", "hairStyle": "coils"}',
  "  ],",
  '  "tracks": {"costs": true, "coordinates": true, "photos": true},',
  '  "rates": {"JPY": 0.0058},',
  '  "translations": {',
  '    "de": {"title": "Japan", "tagline": "sechs Wochen mit dem Zug", "intro": "Sechs Wochen…"}',
  "  },",
  '  "declined": {"plan": "not planning a fixed route ahead of time"}',
  "}",
];

/**
 * Every field the v1 create call takes, and whether it is required — the
 * reference `PERFECT_TRIP_EXAMPLE` is the *shape* of. `test/trip-shape.test.ts`
 * checks it against `NewTrip` in lib/tripWrite.ts, so a field added there and
 * not here fails the build rather than quietly going undocumented.
 */
export const TRIP_FIELDS: {
  key: string;
  required: boolean;
  /** Named here because an agent will look for it, and documented as the one
   *  row that is not a field at all. */
  absent?: true;
  what: string;
}[] = [
  {
    key: "id",
    required: true,
    what:
      "Lowercase letters, digits and dashes. It is in every URL of the trip and **cannot be " +
      "changed afterwards** — `japan-2027` ages better than `the-big-one`.",
  },
  { key: "title", required: true, what: "What the trip is called. One line." },
  {
    key: "start",
    required: true,
    what:
      "`2027-04-01`. Not optional in any sense: the site skips a trip without dates, so one " +
      "written without them exists on disk and nowhere a reader can find it.",
  },
  { key: "end", required: true, what: "`2027-05-15`, the same shape." },
  {
    key: "tagline",
    required: false,
    what: "One line under the title. Ask for it; it is the trip's own subtitle, not a summary you write.",
  },
  {
    key: "status",
    required: false,
    what:
      "`upcoming`, `current` or `past` — accepted and quietly ignored. The dates decide it, " +
      "always: whichever trip's `start`/`end` covers today is the one the bare `/<user>` URLs " +
      "serve, and sending `status` cannot move that.",
  },
  {
    key: "visibility",
    required: false,
    what:
      "`private`, `public` or `guest` — who may open the trip. The answer to a question you " +
      "asked, never a value copied from an example. Left out, it inherits the journal's own " +
      "answer and is never wider than that.",
  },
  {
    key: "listed",
    required: false,
    what:
      "Whether the trip is advertised — sitemap, feed, trip switcher. Only ever narrows: " +
      "`false` on a public trip is a trip you reach by being sent the link, and `true` on a " +
      "trip no visibility advertises is refused rather than written.",
  },
  {
    key: "teaser",
    required: false,
    what:
      "The mirror of `listed`, for a trip nobody may read: `true` on a `guest` or `private` " +
      "trip puts a locked card on `/<user>/trips` carrying the title, the dates and nothing " +
      "else, so a reader knows the journey exists and can ask to be let in. Refused on a " +
      "public trip. It grants nothing — `visibility` still decides who may open it.",
  },
  {
    key: "accent",
    required: false,
    what: "`sky`, `yellow`, `green`, `coral` or `navy` — the trip's colour. Cosmetic; ask, or leave it.",
  },
  {
    key: "costsVisibility",
    required: false,
    what:
      "`public` or `guests`, and only about the money: among the readers already allowed to " +
      "open the trip, `guests` keeps what it cost to the people who were on it and the " +
      "readers the owner has approved. Absent shows the numbers to everyone who can read the trip.",
  },
  {
    key: "intro",
    required: false,
    what:
      "The prose under the trip's own heading — what this journey is, in the person's words. " +
      "The one field here long enough to be worth a sentence of theirs rather than a phrase.",
  },
  {
    key: "tracks",
    required: false,
    what:
      "What this trip keeps, and therefore what every day written into it is **asked** for — " +
      "`costs`, `coordinates`, `photos`. **All three are on unless you turn one off**, and " +
      "a day that is missing one is refused rather than written short, with the two ways " +
      "past it: send the thing, or say in the call that the day does not have it " +
      "(`\"costs\": false`). Turn a row off here only when the person says this journey is " +
      "not keeping that — not to make your own call quieter.",
  },
  {
    key: "people",
    required: false,
    what:
      "Who took the trip: `[{name, email, nickname}]`, at most ten. The byline **and write " +
      "access** — everyone named may write to the whole trip. Correctable later at " +
      "`PATCH .../trips/<id>/people`.",
  },
  {
    key: "travellers",
    required: false,
    what:
      "How the party is drawn. `for` ties a figure to an " +
      "address in `people`. Ask how somebody wants to be drawn and show them the preview; " +
      "never infer it. Correctable at `PATCH .../trips/<id>/travellers`.",
  },
  {
    key: "rates",
    required: false,
    what:
      "`{\"JPY\": 0.0058}` — units of the journal's base currency for one unit of the keyed " +
      "currency, so a currency worth less than the base one has a small number. A currency " +
      "left out is reported unconverted rather than guessed at. Correctable at " +
      "`PATCH .../trips/<id>/rates`.",
  },
  {
    key: "translations",
    required: false,
    what:
      "Title, tagline and introduction in the journal's other languages — `{\"de\": {\"title\", \"tagline\", \"intro\"}}`. " +
      "Correctable later with `PATCH .../trips/<id>`, which replaces the whole translations " +
      "block. A language the journal does not declare is refused.",
  },
  {
    key: "test",
    required: false,
    what:
      "`true` only when the trip is being made to prove the software works rather than to " +
      "record a journey — every day of it then carries a banner and none of it reaches the " +
      "feed, the search index or the sitemap. Deliberately not in the example above, because " +
      "an example is a thing people copy.",
  },
  {
    key: "declined",
    required: false,
    what:
      "Which of v2's `TRIP_DECLINABLES` (`lib/api/v2/schemas/trip.ts`) this trip consciously " +
      "answers \"no\" to, and why — `{\"plan\": \"not planning a fixed route ahead of time\"}`. " +
      "A real reason, at least ten characters: a decline is a message to the next reader, " +
      "not a checkbox. `days` is answered for free — a brand new trip never has one yet.",
  },
  {
    key: "cover",
    required: false,
    absent: true,
    what:
      "**Not a field on this call.** A trip has no photographs when it is created, so anything " +
      "sent here would name a file that is not there. Set it afterwards, once photographs " +
      "exist, with `PATCH /api/v1/{user}/trips/{trip}` — B245.",
  },
];

/** One thing an agent has to ask before its first call. */
export type FirstQuestion = { ask: string; because: string };

/**
 * The questions to put to the person before anything else.
 *
 * Every one of them decides something they live with, and none has a default
 * worth guessing. `lib/whatsapp/onboarding.ts` and `components/SignupWizard.tsx`
 * both ask them, in their own shapes, so they are one list rendered twice
 * rather than two lists that will drift.
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
      ask: "What the **journal is called** (`title`)",
      because:
        "Required — a journal cannot be created without one, and it is the name on every " +
        "page and in the browser tab. Unlike the address above it is correctable later, at " +
        "`PATCH /api/v1/<user>/config`, so a plain answer now is fine.",
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
    {
      ask: "**What they count money in** (`baseCurrency`)",
      because:
        "A three-letter code — every cost anywhere in this journal is added up in it. **It is " +
        "the one field here that can never be changed**: `PATCH /api/v1/<user>/config` refuses " +
        "it outright, because correcting it later would silently re-price every trip already " +
        "written. Tell them it is permanent when you ask, and send the code rather than the " +
        "name — \"francs\" is `CHF`.",
    },
  ];
}

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
 * other agent-facing document on this instance is English: `/documentation.txt`,
 * the `next` line on every API response. A German owner sees German chrome
 * around it, which is the two-layer split in AGENTS.md §1.2 working as
 * designed — the UI is translated, the content is in whatever language it
 * was written in, and this is content addressed to a machine.
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
    `3. The full guide is indexed at ${siteUrl}/documentation.txt — deleting,`,
    "   photographs, letting people in, and a worked example of each, in the",
    "   task guides it links.",
    "",
    "Everything you write arrives as a draft. Putting a day on the site is a",
    "second call, and it is mine to ask for — never publish because something",
    "looks finished. Write what I tell you and nothing I did not.",
  ].join("\n");
}

/**
 * The consequence that the definitions alone do not carry, and the one an
 * owner walked into on the live site — B300.
 *
 * Approving a guest is a grant on the *journal*, and a `private` trip does
 * not honour it: the owner sees "approved", the reader sees a locked page,
 * and no amount of approving changes it. Whoever reads this is the only
 * party in a position to say so before the trip is created.
 */
export const PRIVATE_SHUTS_OUT_GUESTS =
  "A `private` trip stays shut to approved guests too — approving somebody into the journal " +
  "does not open it, and the owner has no way to grant it per person. If the plan is to " +
  "share with family, `guest` is the value, and approving them is the other half of it.";

/**
 * The same choice, for `visibility` on a field list rather than in prose.
 *
 * Short enough for an OpenAPI `description`, where a paragraph would be a
 * wall. Used by `lib/api/openapi.ts` (v1's own hand-written contract).
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
  const request = JSON.stringify({
    user: username,
    email,
    for: "write",
    scope: { trip: tripId },
  });
  const redeem = JSON.stringify({
    user: username,
    email,
    for: "write",
    scope: { trip: tripId },
    code: "<the six digits>",
  });
  return [
    `You are writing one trip in a Fernscout travel journal: ${siteUrl}/${username}/trips/${tripId}`,
    "",
    "1. Ask for a code. It is emailed to me, and I will read it to you — this",
    "   call tells you nothing on its own:",
    "",
    `   curl -X POST ${siteUrl}/api/auth/codes \\`,
    `     -H "content-type: application/json" \\`,
    `     -d ${shellQuote(request)}`,
    "",
    "2. Exchange the six digits for your own 7-day token. The trip was decided",
    "   when the code was issued, so there is nothing more to name here:",
    "",
    `   curl -X POST ${siteUrl}/api/auth/codes/redeem \\`,
    `     -H "content-type: application/json" \\`,
    `     -d ${shellQuote(redeem)}`,
    "",
    "3. Then, before anything else, read where the journal stands:",
    "",
    `   GET ${siteUrl}/api/v1/${username}/status`,
    "",
    `4. The full guide is indexed at ${siteUrl}/documentation.txt — writing a`,
    "   day, photographs, and a worked example of each, in the task guides it",
    "   links.",
    "",
    `Your token writes days into ${tripId} and nothing else in this journal.`,
    "It cannot put a day on the site: everything you write stays a draft until",
    "the person whose journal this is asks for it, and that call is theirs and",
    "not mine. Write what I tell you and nothing I did not — no weather I did",
    "not mention, no meals I did not eat.",
  ].join("\n");
}
