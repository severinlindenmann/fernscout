import "server-only";
import type { Tool } from "../types";
import { ALL_TRACKED, TRACKS, TRACK_ROWS, UNKNOWN, missingFrom } from "../../../tracks";
import { AS_AUTHOR, getAllEntries } from "../../../entries";
import { DAY_ARGS, PREVIEW_CHARACTERS, TRIP_ARG } from "../args";
import { draftsForWizard } from "../../server";
import { factsOfEntry } from "../../../api/entries";
import { firstUnwritten, noTrip, readersOf, resolveDay, resolveTrip, tripIdFor } from "../resolve";

/**
 * A day, from empty to on the site — the arc this product is for.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const DAYS_TOOLS: readonly Tool[] = [
  {
    name: "days",
    kind: "read",
    renders: "choose",
    describe:
      "The days of one trip: the date, what each is called, and whether it is on the site or still a draft.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      return getAllEntries(trip.ref, AS_AUTHOR).map((entry) => ({
        trip: trip.id,
        date: entry.date,
        slug: entry.slug,
        title: entry.title,
        draft: Boolean(entry.draft),
        photos: entry.gallery.length,
      }));
    },
    block: (data, say) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const days = data as { date: string; slug: string; title: string; draft: boolean }[];
      return {
        shape: "choose",
        text: say("agent.block.days"),
        options: days.map((day) => ({
          value: day.slug,
          label: day.title,
          detail: day.date,
        })),
      };
    },
  },
  {
    name: "unfinished",
    kind: "read",
    renders: "choose",
    describe:
      "The days started and not yet published — what is waiting, which trip and date each belongs to, whether it has photographs and whether the words are written.",
    properties: {},
    run: async (username) => draftsForWizard(username),
    block: (data, say) => {
      const days = data as { trip: string; slug: string; date: string; title: string }[];
      if (days.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.unfinished"),
        options: days.map((day) => ({
          value: `${day.trip}/${day.slug}`,
          label: day.title,
          detail: day.date,
        })),
      };
    },
  },
  {
    name: "read_day",
    kind: "read",
    renders: "preview",
    describe:
      "One day of a trip: its title, its slug, whether it is published, how many photographs it carries and the words on it.",
    properties: {
      ...TRIP_ARG,
      date: { type: "string", description: "The day, as YYYY-MM-DD." },
    },
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      const entries = getAllEntries(trip.ref, AS_AUTHOR).filter(
        (entry) => !args.date || entry.date === args.date,
      );
      if (entries.length === 0) return { found: false, trip: trip.id, why: "no day on that date" };
      return entries.map((entry) => ({
        trip: trip.id,
        date: entry.date,
        slug: entry.slug,
        title: entry.title,
        draft: Boolean(entry.draft),
        photos: entry.gallery.length,
        words: entry.content,
      }));
    },
    block: (data, say) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const day = data[0] as { date: string; title: string; words: string };
      return {
        shape: "preview",
        text: say("agent.block.day"),
        // The day's own words and the day's own date: nothing here needs
        // translating, because none of it is this software's prose.
        lines: [day.date, day.title, day.words.slice(0, PREVIEW_CHARACTERS)].filter(
          (line) => line !== "",
        ),
      };
    },
  },
  {
    /**
     * The day itself, started — B818 is the date.
     *
     * **The default is the first day nobody has written, not today.** A person
     * writing up a trip is behind it; today is the one date they are least
     * likely to mean, and it was the one the wizard opened on.
     */
    name: "start_day",
    kind: "write",
    renders: "form",
    describe:
      "Propose starting a day of a trip — an empty day with a date, ready for words and photographs. Nothing is created until they press. Leave the date out and it fills in the first day of the trip nobody has written yet.",
    properties: {
      ...TRIP_ARG,
      date: { type: "string", description: "The day, as YYYY-MM-DD. Omit to use the first unwritten day." },
      /**
       * What they said about the day, when they said it all at once — B969.
       *
       * The commonest thing anybody does here is describe a day in a sentence,
       * and the day usually does not exist yet. The whole paragraph used to be
       * dropped: four times out of four in an ordinary write-up, somebody was
       * told to press a button and then say it all again.
       */
      notes: {
        type: "string",
        description:
          "Anything they already said about the day, in their own words. Pass it through when they described the day while asking for it: it rides to the next card and is not written here. Never write it yourself.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day`,
    propose: async (username, args, say, today) => {
      const trip = resolveTrip(username, args.trip);
      const date = args.date ?? firstUnwritten(username, trip?.id ?? "", today);
      /**
       * The trip's own questions, on the proposal — B917.
       *
       * `POST .../day` refuses a day that says nothing about what its trip
       * keeps (`lib/tracks.ts`), and the conversation had no way to answer:
       * every press came back `incomplete_day`. So the questions are fields
       * like any other, and they open on `unknown` — which is not a guess but
       * the literal state of affairs, exactly as B810 decided for the wizard's
       * express path: money was spent and nobody has told this journal the
       * figures. Nothing is invented; nobody has been asked yet. A real
       * figure is `add_cost` afterwards, and the sentence says so.
       *
       * Only the `write` rows: `photos` is asked at publish, and there is no
       * photograph at creation for anybody to answer about.
       */
      const asked = TRACKS.filter(
        (row) => TRACK_ROWS[row].when === "write" && (trip?.tracks ?? ALL_TRACKED)[row],
      );
      const sentence = say("agent.tool.startDay", {
        date,
        trip: trip?.title ?? "",
      });
      /**
       * **Their words, carried across the press** — B969.
       *
       * `POST .../day` makes an empty day and cannot hold prose, which is
       * right: writing and reading back are two steps here as they are
       * everywhere else. What was missing is that the notes somebody had
       * *already given* went nowhere, so they typed their paragraph, pressed,
       * and typed it again.
       *
       * `next` is the mechanism `draft_words` already uses to hand its prose
       * to `set_day_words`. The browser carries this proposal's own arguments
       * into the next one, so the notes ride along and the trip and slug come
       * from what the route actually wrote.
       *
       * Only when there are notes. A card offering to spend a credit writing
       * up an empty day is worse than no card.
       */
      const carryOn = (args.notes ?? "").trim() !== "";
      return {
        ...(carryOn
          ? { next: { tool: "draft_words", from: { trip: "trip", slug: "slug" } } }
          : {}),
        sentence: asked.length > 0 ? `${sentence} ${say("agent.tool.startDayUnknown")}` : sentence,
        accept: say("agent.tool.startDayAccept"),
        done: say("agent.tool.startDayDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          { name: "date", value: date, date: true },
          ...asked.map((row) => ({
            name: row,
            value: UNKNOWN,
            options: [
              { value: UNKNOWN, label: say("agent.answerUnknown") },
              { value: "none", label: say("agent.answerNone") },
            ],
          })),
        ],
      };
    },
  },
  {
    /**
     * The one tool that spends a credit, and it spends it on the press.
     *
     * It writes nothing either: `POST .../day/write-day` returns prose to be
     * read, and keeping it is `set_day_words` — a second proposal and a second
     * press, which is `next`. The person reads what came back before any of it
     * is in their journal, which is what makes the "write only what you were
     * told" rule checkable rather than merely stated.
     */
    name: "draft_words",
    kind: "write",
    renders: "form",
    describe:
      "Propose turning their own notes about a day into a title and a few paragraphs. Nothing is written and nothing is spent until they press; what comes back is shown to them to read, change or throw away. It costs one credit.",
    properties: {
      ...DAY_ARGS,
      notes: {
        type: "string",
        description:
          "Their own notes about the day, in their own words, exactly as they said them. Never write these yourself and never add anything they did not say.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/write-day`,
    // What came back is prose to read, not a day. Keeping it is the second
    // proposal and the second press: `draft.prose` is what the write-day
    // route calls the words.
    next: { tool: "set_day_words", from: { title: "draft.title", content: "draft.prose" } },
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        sentence: say("agent.tool.draftWords", { credits: "1" }),
        accept: say("agent.tool.draftWordsAccept"),
        done: say("agent.tool.draftWordsDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "date", value: found?.entry.date ?? args.date ?? "", date: true },
          { name: "notes", value: args.notes ?? "", long: true },
        ],
      };
    },
  },
  {
    name: "set_day_words",
    kind: "write",
    renders: "form",
    describe:
      "Propose the title and the words of a day that already exists. Use their own words, never yours. Nothing is saved until they press, and a day already on the site stays on the site. Also how a wrong word on a day is corrected.",
    properties: {
      ...DAY_ARGS,
      title: { type: "string", description: "The day's title, short, from what they said." },
      content: { type: "string", description: "The day's words, in their language, as they said them." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        /**
         * **A guess may not overwrite what is already written** — B954.
         *
         * `resolveDay` falls back to the newest day when nothing names one,
         * and that is right for the ordinary flow: somebody who has just
         * started a day and says "now the words" means that day. It is not
         * right when the day it landed on already has prose and nobody said
         * which day — that is somebody's writing replaced on a guess, by a
         * press this card invited them to make.
         *
         * The distinction is the day's own state rather than the phrasing:
         * filling an empty day costs nothing if it is the wrong one, and it
         * is the case the fallback exists for.
         */
        ...(found?.guessed && found.entry.content.trim() !== ""
          ? { refuse: "agent.tool.whichDayToRewrite" }
          : {}),
        sentence: say("agent.tool.setWords", { date: found?.entry.date ?? args.date ?? "" }),
        accept: say("agent.tool.setWordsAccept"),
        done: say("agent.tool.setWordsDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "title", value: args.title ?? found?.entry.title ?? "" },
          /**
           * What the day already says, when nothing was proposed — B942.
           *
           * It opened on nothing, under a sentence saying it would set the
           * day's words — and no press of it could succeed, because
           * `lib/api/entries.ts` refuses empty content. B929's shape again: a
           * proposal on somebody's screen that nothing can accept.
           *
           * It is also what makes a correction possible at all (B941). A
           * person saying "it should say udon, not ramen" is editing one word
           * of a paragraph, and the model had to reproduce the whole
           * paragraph from memory to do it — expensive, easy to get wrong,
           * and the reason it reached for a different tool instead.
           *
           * A day with no words at all stays refused, which is right: that
           * is not an edit, it is deleting the day.
           */
          { name: "content", value: args.content ?? found?.entry.content ?? "", long: true },
        ],
      };
    },
  },
  {
    /**
     * **A rendered day, and then one press.** The preview is not decoration
     * and not optional: publishing is the moment a day becomes readable by
     * other people, and the plan's rule is that it happens after somebody has
     * read it back — never from a sentence. There are no editable fields,
     * because there is nothing here to correct: a wrong day is corrected by
     * saying which day, and the next turn proposes that one.
     */
    name: "publish_day",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose putting a day on the site. This shows them the day as their readers will see it and stops; it publishes nothing. Only the button under it publishes.",
    properties: DAY_ARGS,
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/publish`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      /**
       * The publish-time questions, on the confirmation — B929, and B917's
       * fix at the other end of the day's life.
       *
       * `photos` is a `publish` row (`lib/tracks.ts`), so nothing before this
       * moment could answer it and the press came back `incomplete_day` every
       * time. Whatever the route is about to refuse is asked here instead —
       * `missingFrom` is the same function the route runs, so the two cannot
       * drift into asking different questions.
       *
       * They open on `unknown`, which is not a guess: nobody has been asked
       * yet, and "there are pictures somewhere and nobody has them to hand"
       * is the true thing to write. **They are not in `properties`**, so the
       * model cannot answer them on somebody's behalf; only the person's own
       * select does.
       */
      const asked = found
        ? missingFrom(factsOfEntry(found.entry), found.trip.tracks, "publish").map((row) => row.field)
        : [];
      /**
       * **Who will be able to read it, in the same breath as the button** —
       * B933, and it is the sentence this whole product is for.
       *
       * She could only find out that her daughter had no access by reading
       * `people: []` and `invites: []` out of the API. Every persona here has
       * asked some version of *"can my mother read this"*, and the answer has
       * always cost either a route call or a leap of faith — which is exactly
       * how B931 happened: a trip set to `guest` so one named person could
       * read it, nobody approved, and the model saying she could.
       *
       * Before the press rather than after it. Publishing is the moment a day
       * becomes readable by other people, and the audience is the thing a
       * person is actually consenting to.
       *
       * It says **nought as a sentence**, never as a number: "only you, and
       * you have not let anybody in yet" is the reading that would have
       * caught B931 without an agent.
       */
      const audience = found ? await readersOf(username, found.trip.id, say) : "";
      const sentence = found
        ? `${say("agent.tool.publishDay", { date: found.entry.date, title: found.entry.title })} ${audience}`
        : say("agent.tool.publishNoDay");
      return {
        sentence:
          asked.length > 0 ? `${sentence} ${say("agent.tool.publishDayUnknown")}` : sentence,
        accept: say("agent.tool.publishDayAccept"),
        done: say("agent.tool.publishDayDone"),
        preview: found
          ? [found.entry.date, found.entry.title, found.entry.content.slice(0, PREVIEW_CHARACTERS)].filter(
              (line) => line !== "",
            )
          : [],
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          ...asked.map((row) => ({
            name: row,
            value: UNKNOWN,
            options: [
              { value: UNKNOWN, label: say("agent.answerUnknown") },
              { value: "none", label: say("agent.answerNone") },
            ],
          })),
        ],
      };
    },
  },
  {
    /**
     * The takedown, and **it is not a delete** (B816).
     *
     * The day goes back to being a draft: off the site, off the feed, still on
     * disk with every photograph attached, and publishing it again is the
     * undo. Nothing in this registry deletes anything, and the words that mean
     * *destroy* are refused before a model is asked at all.
     */
    name: "unpublish_day",
    kind: "write",
    renders: "confirm",
    describe:
      "Propose taking a day back off the site. It becomes a draft again — nothing is deleted, every photograph stays, and publishing it again puts it back. Nothing happens until they press.",
    properties: DAY_ARGS,
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/unpublish`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      return {
        /**
         * A day that was never up does not come down — B951.
         *
         * `publish_day` has always refused a day that is already published;
         * its mirror had no such check, so asking to take down a draft
         * produced a confirmation card saying it *"comes off the site and
         * goes back to being a draft"* about a day that had never been on the
         * site. The press would have answered `already_draft`; the sentence
         * she read before pressing said her day was live.
         */
        ...(found?.entry.draft ? { refuse: "agent.tool.alreadyDraft" } : {}),
        sentence: found
          ? say("agent.tool.unpublishDay", { date: found.entry.date, title: found.entry.title })
          : say("agent.tool.publishNoDay"),
        accept: say("agent.tool.unpublishDayAccept"),
        done: say("agent.tool.unpublishDayDone"),
        fields: [
          { name: "trip", value: tripIdFor(username, args, found) },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
        ],
      };
    },
  },
];
