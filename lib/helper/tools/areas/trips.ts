import "server-only";
import type { Tool } from "../types";
import { TRIP_ARG } from "../args";
import { getTrip, getTrips, tripRef } from "../../../trips";
import { isEnabled } from "../../../capabilities";
import { listContacts } from "../../../contacts";
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
];
