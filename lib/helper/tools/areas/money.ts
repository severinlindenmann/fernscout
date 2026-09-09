import "server-only";
import type { Tool } from "../types";
import { AS_AUTHOR } from "../../../entries";
import { COST_CATEGORIES, conversionFor, getCostSummary } from "../../../costs";
import { DAY_ARGS, TRIP_ARG } from "../args";
import { noTrip, resolveDay, resolveTrip, tripIdFor } from "../resolve";
import { normalizeCurrency } from "../../../currency";
import { tripRef } from "../../../trips";

/**
 * What a trip cost, and what one thing on one day cost.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 */
export const MONEY_TOOLS: readonly Tool[] = [
  {
    name: "trip_costs",
    kind: "read",
    renders: "say",
    describe:
      "What a trip has cost so far, not the journal's own credits (account): the total, what was spent preparing, the daily average, and the largest categories. Every figure is in the journal's own currency. `notInTheTotal` is money it could not convert and left out: if it is not empty, say so and how much.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      /**
       * **The owner's own money, read as the owner** — B959.
       *
       * This read the trip as an anonymous visitor, so costs on a day still in
       * draft were invisible — in the owner's own conversation, about their
       * own spend. Every other read tool in this file passes `AS_AUTHOR`; this
       * one did not, and the write-up case is exactly the one it breaks:
       * somebody logging what they spent as they write, before publishing.
       *
       * Three answers in one session, all false: *"the total is 0 CHF because
       * nothing has been saved yet"* with two costs on disk, *"nothing has
       * been recorded yet"* with four, and *"31 CHF"* with six — the two that
       * happened to be on published days.
       *
       * B955 made the model call this tool instead of adding up itself, which
       * was right and which made this worse in one exact way: a wrong sum it
       * derived looks second-guessable, and a wrong sum from the tool that
       * reads the disk does not.
       */
      const costs = getCostSummary(tripRef(username, trip.id), new Date(), AS_AUTHOR);
      return {
        trip: trip.id,
        currency: costs.baseCurrency,
        total: costs.total,
        preparation: costs.preparation,
        onTheRoad: costs.onTheRoad,
        perDay: costs.perDay,
        // B560 — a day nobody wrote costs down for reads as a zero, so the
        // total is a floor rather than a figure and the model must be able
        // to say so.
        daysWithNothingRecorded: costs.unrecordedDays,
        /**
         * **What the total does not include** — B960.
         *
         * A trip's `rates:` block is what converts foreign spend into the
         * journal's own currency, and `add_cost` never writes one — so a trip
         * built entirely through the conversation has none, and every cost in
         * anything but the base currency is left out of `total`.
         *
         * Six costs in three currencies came back as *"Total for the trip so
         * far: 31 CHF"*, being the two in CHF. Real spend was over two hundred
         * at any plausible rate, and nothing said a word.
         *
         * `getCostSummary` has known this all along — `unconverted` is its
         * own field and this tool simply dropped it, so even a model inclined
         * to mention it had nothing to mention. A total that admits to being
         * partial is honest; one that cannot is the shape of every fault found
         * this week.
         *
         * Where a rate should come *from* is a real decision and is not this:
         * converting at a rate nobody chose is exactly the invention this
         * codebase refuses everywhere else.
         */
        notInTheTotal: costs.unconverted.map((one) => ({
          currency: one.currency,
          amount: one.amount,
          items: one.count,
        })),
        byCategory: costs.byCategory.map((one) => ({
          category: one.category,
          amount: one.amount,
        })),
      };
    },
  },
  {
    name: "add_cost",
    kind: "write",
    renders: "form",
    describe:
      "Propose one thing a day cost — what it was, how much, which category. Only ever a figure they gave you. Nothing is recorded until they press. Never to correct a day's words: that is set_day_words.",
    properties: {
      ...DAY_ARGS,
      label: { type: "string", description: "What it was, in their words." },
      amount: { type: "string", description: "How much, as a number. Never one you worked out." },
      currency: { type: "string", description: "The three-letter code, if they said one." },
      category: {
        type: "string",
        // B968 — the closed list, said out loud. It was described as "one of
        // the journal's own categories" without naming them, so the model
        // supplied "Food" and "Attractions" and every press came back
        // `invalid_cost`.
        description: `One of: ${COST_CATEGORIES.join(", ")}. Leave it out rather than guessing.`,
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/day/costs`,
    propose: async (username, args, say) => {
      const found = resolveDay(username, args);
      const tripId = tripIdFor(username, args, found);
      /**
       * **A currency nobody said is a guess, and the guess is shown** — B973.
       *
       * "We spent 15 on the museum" reached the route as `currency: ""`, which
       * `lib/costs.ts` has always read as the trip's base currency — right for
       * every day written before multi-currency existed, and silent about it
       * ever since. On a trip based in CHF while the person stands in Portugal
       * saying "fifteen", the guess is wrong half the time, and the person
       * pressing the button never saw it being made.
       *
       * Not refusing it: an empty currency has been a valid cost since before
       * this ticket, and refusing it now would break every day already on
       * disk. Showing the guess, editable, with the trip's own currencies
       * (its base plus anything `rates:` already knows) as options, is what
       * makes it something a person corrects rather than discovers.
       */
      const said = normalizeCurrency(args.currency);
      const { base, rates } = tripId
        ? conversionFor(tripRef(username, tripId))
        : { base: "", rates: {} };
      const tripCurrencies = base ? Array.from(new Set([base, ...Object.keys(rates)])) : [];
      return {
        sentence: say("agent.tool.addCost", {
          label: args.label ?? "",
          amount: args.amount ?? "",
        }),
        accept: say("agent.tool.addCostAccept"),
        done: say("agent.tool.addCostDone"),
        fields: [
          { name: "trip", value: tripId },
          { name: "slug", value: found?.entry.slug ?? args.slug ?? "" },
          { name: "date", value: args.date ?? found?.entry.date ?? "", date: true },
          { name: "label", value: args.label ?? "" },
          { name: "amount", value: args.amount ?? "" },
          {
            name: "currency",
            value: said || base,
            ...(tripCurrencies.length > 0
              ? { options: tripCurrencies.map((one) => ({ value: one, label: one })) }
              : {}),
          },
          /**
           * **The closed list it always was** — B968.
           *
           * This drew whatever the model said, and the route accepts only the
           * lowercase members of `COST_CATEGORIES`. So `"Food"` and
           * `"Attractions"` reached somebody's screen as a filled-in field and
           * every press came back `invalid_cost` — B925's fault with the check
           * missing: a proposal no press can accept.
           *
           * `create_trip`'s `visibility` is the shape: matched against the
           * list, an unrecognised word dropped rather than guessed at, and
           * drawn as options so a person can correct it. Case-insensitively,
           * because the model's own capitalisation is not a decision anybody
           * made.
           */
          {
            name: "category",
            value:
              (COST_CATEGORIES as readonly string[]).find(
                (one) => one === args.category?.trim().toLowerCase(),
              ) ?? "",
            options: COST_CATEGORIES.map((one) => ({ value: one, label: one })),
          },
        ],
      };
    },
  },
];
