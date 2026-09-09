import "server-only";
import type { Tool } from "../types";
import { TRIP_ARG } from "../args";
import { getTrip, getTrips, tripRef } from "../../../trips";
import { isEnabled } from "../../../capabilities";
import { listContacts } from "../../../contacts";
import { ALL_TRACKED, TRACKS, type Track } from "../../../tracks";
import { VISIBILITIES } from "../../../tripWrite";
import { noTrip, resolveTrip } from "../resolve";

/**
 * The trip itself: what exists, who may read it, and making one.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const TRIPS_TOOLS: readonly Tool[] = [
  {
    name: "trips",
    kind: "read",
    renders: "choose",
    describe: "Every trip in this journal: its id, title and the days it runs between.",
    properties: {},
    run: async (username) =>
      getTrips(username)
        .map((trip) => ({ id: trip.id, title: trip.title, start: trip.start, end: trip.end }))
        .sort((a, b) => b.start.localeCompare(a.start)),
    block: (data, say) => {
      const trips = data as { id: string; title: string; start: string; end: string }[];
      if (trips.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.trips"),
        options: trips.map((trip) => ({
          value: trip.id,
          label: trip.title,
          detail: `${trip.start} – ${trip.end}`,
        })),
      };
    },
  },
  {
    /**
     * The first write tool, and it writes nothing.
     *
     * **Visibility is a field rather than a default**, and the three labels
     * are sentences rather than words: the mistake a person makes at exactly
     * this moment is answering "who can see it" with the wrong one of *guest*
     * and *private*, and the difference — everybody I let into this journal,
     * against only the people who were there — cannot be carried by the word
     * alone. It is prefilled with what the journal's own default would be, and
     * it is on the screen to be read before the press.
     */
    name: "create_trip",
    kind: "write",
    renders: "form",
    describe:
      "Propose a new trip — a journey with a title, a first and last day, and who may read it. This creates nothing: it fills the fields in and the person presses. Never say in your own words who can read it — the field's labels do.",
    properties: {
      title: { type: "string", description: "What the trip is called, in the writer's own words." },
      start: { type: "string", description: "The first day, as YYYY-MM-DD." },
      end: { type: "string", description: "The last day, as YYYY-MM-DD." },
      visibility: {
        type: "string",
        description:
          "Who may read it: public (anybody), guest (everybody let into this journal), private (ONLY the people who were on the trip). A person they name is a guest — \"only my daughter should read this\" is guest; private shuts her out. Leave it out unless they said.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip`,
    propose: async (_username, args, say) => ({
      /**
       * The sentence, and then the line about who may read it — B923.
       *
       * *"nur meine Tochter soll das lesen können"* came back proposing
       * `private`, which means the people who were on the trip and would have
       * shut her daughter out; the model's own prose said the opposite of the
       * label beside it. The label is the whole safety here, so the sentence
       * points at it rather than paraphrasing it, and the tool tells the model
       * not to describe who can read a trip in words of its own.
       */
      sentence: `${say("agent.tool.createTrip", {
        title: args.title ?? "",
        start: args.start ?? "",
        end: args.end ?? "",
      })} ${say("agent.tool.createTripVisibility")}`,
      accept: say("agent.tool.createTripAccept"),
      done: say("agent.tool.createTripDone"),
      fields: [
        { name: "title", value: args.title ?? "" },
        { name: "start", value: args.start ?? "", date: true },
        { name: "end", value: args.end ?? "", date: true },
        {
          name: "visibility",
          value: ["public", "guest", "private"].includes(args.visibility ?? "")
            ? args.visibility
            : "guest",
          options: [
            { value: "public", label: say("agent.tool.visibilityPublic") },
            { value: "guest", label: say("agent.tool.visibilityGuest") },
            { value: "private", label: say("agent.tool.visibilityPrivate") },
          ],
        },
      ],
    }),
  },
  {
    name: "who_can_read",
    kind: "read",
    renders: "say",
    describe:
      "Who a trip is open to: public (everybody), guest (everybody let into this journal) or private (only the people who were on it), whether it is advertised, and how many people are named on it.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      const full = getTrip(tripRef(username, trip.id));
      if (!full) return { found: false, why: "that trip could not be read" };
      /**
       * **The people, not the vocabulary** — B933.
       *
       * This used to answer `visibility: "guest", peopleNamed: 0` and leave
       * the model to turn that into a sentence, which is how *"nur Sie und
       * Ihre Tochter können sie sehen"* was said about a trip her daughter
       * could not open (B931). Every persona in this project has asked some
       * version of *"can my mother read this"*, and the honest answer has
       * always needed either a route call or a leap of faith.
       *
       * Names come from the file, which is the owner's own editorial
       * statement about whose trip it was. **Addresses never do**: an email
       * in a tool result is an email in the prompt, and nobody asked for
       * their address to be read out because somebody wondered who could
       * read a day.
       */
      const approved = isEnabled("contacts", username)
        ? (await listContacts(username)).filter((one) => one.approvedAt !== null).length
        : 0;
      return {
        trip: full.id,
        visibility: full.visibility,
        listed: full.listed,
        teaser: Boolean(full.teaser),
        peopleNamed: full.people.length,
        // Who they are, by the name the owner wrote down.
        people: full.people.map((one) => one.name).filter((name) => name !== ""),
        /**
         * How many people have been let into the **journal**, which is what a
         * `guest` trip is open to. Nought here is the whole of B931: a trip
         * set to `guest` so that one named person could read it, and nobody
         * approved, reads to somebody as "my daughter can see it" and is not.
         */
        guestsApprovedIntoJournal: approved,
        contactsOff: !isEnabled("contacts", username),
      };
    },
  },
  {
    /**
     * The correction `create_trip` has no way to make.
     *
     * A title typed wrong, or dates that turn out to have been a day off, used
     * to mean deleting the trip and starting again, which takes the days in it
     * too. `patchTripDetails` is the same function `PATCH /api/v1/.../trips/
     * {trip}` calls, so a trip edited this way is a trip edited any other way
     * — and, per that route's own comment, `cover`, `accent`, `intro` and
     * `costsVisibility` are deliberately left off this card: none of them is
     * what anybody has ever asked the conversation to change, and a field on
     * the screen that is never the answer is a field somebody has to read past
     * every time.
     */
    name: "edit_trip",
    kind: "write",
    renders: "form",
    describe:
      "Propose a new title or new dates for a trip that already exists. Nothing changes until they press.",
    properties: {
      ...TRIP_ARG,
      title: { type: "string", description: "The trip's new title, if it changed." },
      start: { type: "string", description: "The new first day, as YYYY-MM-DD, if it changed." },
      end: { type: "string", description: "The new last day, as YYYY-MM-DD, if it changed." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const trip = resolveTrip(username, args.trip);
      return {
        sentence: say("agent.tool.editTrip", {
          title: args.title ?? trip?.title ?? "",
          start: args.start ?? trip?.start ?? "",
          end: args.end ?? trip?.end ?? "",
        }),
        accept: say("agent.tool.editTripAccept"),
        done: say("agent.tool.editTripDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          { name: "title", value: args.title ?? trip?.title ?? "" },
          { name: "start", value: args.start ?? trip?.start ?? "", date: true },
          { name: "end", value: args.end ?? trip?.end ?? "", date: true },
        ],
      };
    },
  },
  {
    /**
     * `create_trip`'s own card, on a trip that already exists — B933's mistake
     * happens again the moment somebody decides a trip should open up or close
     * down, so it gets the identical sentences and the identical options
     * rather than a shorter copy that could drift from them.
     *
     * A separate route from `edit_trip`, deliberately: `PATCH .../visibility`
     * already exists as its own door in the contract for the reason its own
     * comment gives — widening who may read a trip is a different kind of
     * change from renaming it, worth its own warning (`result.widened`), and
     * folding it into one body with `title`/`start`/`end` would make that
     * warning conditional on which keys happened to be sent in the same call.
     */
    name: "set_visibility",
    kind: "write",
    renders: "form",
    describe:
      "Propose who may read a trip that already exists. Nothing changes until they press. Never say in your own words who can read it — the field's labels do.",
    properties: {
      ...TRIP_ARG,
      visibility: {
        type: "string",
        description:
          "Who may read it: public (anybody), guest (everybody let into this journal), private (ONLY the people who were on the trip). Leave it out unless they said.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip/visibility`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const trip = resolveTrip(username, args.trip);
      return {
        sentence: `${say("agent.tool.setVisibility", { trip: trip?.title ?? "" })} ${say("agent.tool.createTripVisibility")}`,
        accept: say("agent.tool.setVisibilityAccept"),
        done: say("agent.tool.setVisibilityDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          {
            name: "visibility",
            value: (VISIBILITIES as readonly string[]).includes(args.visibility ?? "")
              ? (args.visibility as string)
              : (trip?.visibility ?? "guest"),
            options: [
              { value: "public", label: say("agent.tool.visibilityPublic") },
              { value: "guest", label: say("agent.tool.visibilityGuest") },
              { value: "private", label: say("agent.tool.visibilityPrivate") },
            ],
          },
        ],
      };
    },
  },
  {
    /**
     * Adding somebody to the byline after the trip already exists — the
     * ordinary case, not the exception: "my partner was on this too" arrives
     * once days are already being written more often than before the trip was
     * made.
     *
     * **Wholesale, not merged, at the route** — `patchTripParty`'s own rule
     * (`lib/api/tripParty.ts`): a party's membership and order both mean
     * something, so the route reads the trip's own list and sends the whole
     * thing back with this person folded in by email, rather than this tool
     * trying to describe an edit to a list it cannot see. One person a press,
     * on purpose: removing somebody is an edit to the byline itself, not an
     * addition, and belongs to a person reading the list back rather than to
     * a name spoken in passing.
     */
    name: "trip_people",
    kind: "write",
    renders: "form",
    describe:
      "Propose adding somebody to a trip's byline — who was on it. Everyone listed may also write to the whole trip, not just read it. Nothing changes until they press.",
    properties: {
      ...TRIP_ARG,
      person: { type: "string", description: "Their name, as the writer said it." },
      email: {
        type: "string",
        description:
          "Their email address. Required before this can be proposed — it is how they get a token scoped to this trip.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip/people`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const trip = resolveTrip(username, args.trip);
      const name = (args.person ?? "").trim();
      const email = (args.email ?? "").trim();
      return {
        // A name with no address to write into `people:` is not yet a
        // proposal — B925's rule applied here: a card cannot invite a press
        // it knows will come back `invalid_people`.
        ...(trip && (!name || !email) ? { refuse: "agent.tool.tripPeopleNeedsEmail" } : {}),
        sentence: say("agent.tool.tripPeople", { name, trip: trip?.title ?? "" }),
        accept: say("agent.tool.tripPeopleAccept"),
        done: say("agent.tool.tripPeopleDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          { name: "person", value: name },
          { name: "email", value: email },
        ],
      };
    },
  },
  {
    /**
     * `lib/tracks.ts`'s own settings, reached from the conversation instead of
     * a shell — the call an owner reaches for half way through a journey, when
     * they have decided they are not going to keep logging what everything
     * cost. Turning a row off changes nothing already written; it only stops
     * a day being refused for missing it from now on (`patchTripTracks`).
     */
    name: "trip_tracks",
    kind: "write",
    renders: "form",
    describe:
      "Propose what a trip asks every day for — its costs, its coordinates, its photographs. Turning a row off stops future days being refused for missing it; nothing already written changes.",
    properties: {
      ...TRIP_ARG,
      costs: { type: "string", description: "on or off, if they said to change whether this trip tracks what it costs." },
      coordinates: {
        type: "string",
        description: "on or off, if they said to change whether this trip tracks where its days happened.",
      },
      photos: { type: "string", description: "on or off, if they said to change whether this trip tracks photographs." },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/trip/tracks`,
    method: "PATCH",
    propose: async (username, args, say) => {
      const trip = resolveTrip(username, args.trip);
      const current = trip?.tracks ?? ALL_TRACKED;
      const on = (row: Track): boolean => {
        const said = (args[row] ?? "").trim().toLowerCase();
        if (said === "on" || said === "true") return true;
        if (said === "off" || said === "false") return false;
        return current[row];
      };
      return {
        sentence: say("agent.tool.tripTracks", { trip: trip?.title ?? "" }),
        accept: say("agent.tool.tripTracksAccept"),
        done: say("agent.tool.tripTracksDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "" },
          ...TRACKS.map((row) => ({
            name: row,
            value: on(row) ? "true" : "false",
            options: [
              { value: "true", label: say("agent.tool.tripTracksOn") },
              { value: "false", label: say("agent.tool.tripTracksOff") },
            ],
          })),
        ],
      };
    },
  },
];
