import "server-only";
import type { Tool } from "../types";
import { DAY_ARGS, TRIP_ARG } from "../args";
import { isEnabled } from "../../../capabilities";
import { isTestContent } from "../../../access";
import { AS_AUTHOR, getAllEntries } from "../../../entries";
import { balanceOf, creditsEnabled } from "../../../credits";
import { POSTCARD_CREDITS } from "../../../credits/pricing";
import { defaultLocaleFor, localesFor } from "../../../locales";
import { mediaKey } from "../../../photos";
import { getOrder, orderCost } from "../../../postcard/orders";
import { postcardCandidates } from "../../../postcard/contacts";
import { openingOf } from "../../../postcard/opening";
import { getPhotobookOrder } from "../../../photobook/orders";
import { BOOK_SIZES, COVER_TYPES, type CoverType } from "../../../photobook/spec";
import { noTrip, resolveDay, resolveTrip, tripIdFor } from "../resolve";

/**
 * Printed things: a postcard proposed from one photograph, a photobook handed
 * over to its own maker, and where either order stands.
 *
 * One area of the registry — B1042. The tools were a nine-hundred-line array
 * in a single file, which is a file two people cannot edit at once and nobody
 * can read the shape of. What decides where a tool lives is what a person is
 * doing, not which route it posts to.
 *
 * **Nothing here prints or charges.** AGENTS.md is explicit about the one
 * thing an agent cannot finish: `POST .../postcards` writes a proposal and
 * hands over a URL, and only the owner's own press on `/<user>/postcards/<id>`
 * spends a credit at a printer. The photobook is the same shape one level
 * further out — there is not even a route that *creates* an order ahead of
 * the composer, because planning, pricing and paying all happen on that one
 * page (`app/[user]/photobook/order/route.ts`) and nowhere else. So
 * `propose_postcards` posts to a helper route that writes a real, pending
 * order; `photobook` only hands over the maker's own link. Neither is a
 * `kind: "link"` tool outright, because the person still reads a sentence and
 * presses a button first — the button just leads to a page rather than to a
 * printer.
 */

/** A trip-relative photo path, the shape `resolveMediaFile` and
 *  `createOrder`'s `photo` field both expect — B434's `photo` is relative to
 *  the trip's own media directory, and `entry.gallery[].src` already carries
 *  the owner and the trip id on the front (`mediaWithOwner`, lib/trips.ts). */
function relativePhoto(tripId: string, src: string): string {
  const key = mediaKey(src); // "<tripId>/…"
  const prefix = `${tripId}/`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

export const PRINTED_TOOLS: readonly Tool[] = [
  {
    name: "postcard_recipients",
    kind: "read",
    renders: "choose",
    describe:
      "Who a postcard could go to: a name, a town and a country for each — never a street. Look here before proposing cards; a card can only be addressed to somebody on this list.",
    properties: {},
    run: async (username) => {
      if (!isEnabled("postcards", username) || !isEnabled("contacts", username)) {
        return { available: false, recipients: [] };
      }
      return { available: true, recipients: await postcardCandidates(username) };
    },
    block: (data, say) => {
      const result = data as {
        available: boolean;
        recipients: { contactId: string; name: string; city: string; country: string | null }[];
      };
      if (!result.available || result.recipients.length === 0) return null;
      return {
        shape: "choose",
        text: say("agent.block.postcardRecipients"),
        options: result.recipients.map((r) => ({
          value: r.contactId,
          label: r.name,
          detail: [r.city, r.country].filter(Boolean).join(", "),
        })),
      };
    },
  },
  {
    name: "postcard_texts",
    kind: "read",
    renders: "preview",
    describe:
      "What each day of a trip could say on the back of a card: its opening lines, in every language this journal keeps. Read this before writing a message, so it can be theirs rather than invented.",
    properties: TRIP_ARG,
    run: async (username, args) => {
      if (!isEnabled("postcards", username) || !isEnabled("contacts", username)) {
        return { found: false, why: "postcards are not switched on for this journal" };
      }
      const trip = resolveTrip(username, args.trip);
      if (!trip) return noTrip(username, args.trip);
      const written = defaultLocaleFor(username);
      const offered = localesFor(username);
      // The same trimming `GET …/postcards/texts` answers with — see that
      // route's own comment for why a whole trip comes back in one call
      // rather than a fetch per day and per language.
      const days = getAllEntries(trip.ref, AS_AUTHOR)
        .filter((entry) => !isTestContent(trip, entry))
        .map((entry) => {
          const texts: Record<string, string> = {};
          for (const locale of offered) {
            const source = locale === written ? entry.content : entry.translations?.[locale]?.content;
            const opening = openingOf(source ?? "");
            if (opening) texts[locale] = opening;
          }
          return { date: entry.date, title: entry.title, texts };
        })
        .filter((day) => Object.keys(day.texts).length > 0);
      return { found: true, trip: trip.id, writtenLocale: written, days };
    },
    block: (data, say) => {
      const result = data as {
        found: boolean;
        days?: { date: string; title: string; texts: Record<string, string> }[];
        writtenLocale?: string;
      };
      if (!result.found || !result.days || result.days.length === 0) return null;
      return {
        shape: "preview",
        text: say("agent.block.postcardTexts"),
        lines: result.days.map((day) => {
          const opening = day.texts[result.writtenLocale ?? "en"] ?? Object.values(day.texts)[0];
          return `${day.date} — ${day.title}: “${opening}”`;
        }),
      };
    },
  },
  {
    /**
     * The proposal itself — B434, from the conversation's side of it.
     *
     * **No `next`.** The other chained tool in this registry, `draft_words` →
     * `set_day_words`, exists because prose has to be *kept* in a second
     * write. There is nothing to keep here: the order this writes already is
     * the thing, and what follows is a person opening a URL, not another
     * proposal. The URL still reaches the conversation — the route answers
     * with `url` and `HelperAsk`'s own `previewOf()` already knows to draw any
     * answer's `url` as a preview line, the same generic path `invite_guest`
     * uses, so no client change was needed for this "handover" either.
     */
    name: "propose_postcards",
    kind: "write",
    renders: "form",
    describe:
      "Propose real postcards: one photograph and message from a day, to recipients from postcard_recipients. Writes a pending order and hands over their postcards page URL — charges and prints nothing; only their press there spends credits at a printer.",
    properties: {
      ...DAY_ARGS,
      photo: {
        type: "string",
        description:
          "Which photograph of that day, by its file name as read_day names it. Omit for the first photograph on the day.",
      },
      message: {
        type: "string",
        description:
          "The words on the back of the card, in their own words exactly as they said them. Never invent anything they did not say.",
      },
      from: {
        type: "string",
        description: "The signature on the card — how they sign it, e.g. their own name.",
      },
      recipients: {
        type: "string",
        description:
          "Who it goes to: contact ids from postcard_recipients, comma separated. Never a name typed from memory — look the id up first.",
      },
      locale: {
        type: "string",
        description: "The language the card is written in, if not the journal's own default.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/postcard`,
    propose: async (username, args, say) => {
      // Absent rather than broken (AGENTS.md): the tool stays in the model's
      // list either way — filtering the registry per journal is not
      // structurally possible here (`TOOLS` is built once, with no
      // journal in view) — but `refuse` (B951) is the same effect from the
      // other side: no button reaches the screen, only a sentence saying
      // why, alongside the rest of `Proposed`'s required fields so the type
      // stays honest about what a declined proposal still carries.
      const unavailable = !isEnabled("postcards", username) || !isEnabled("contacts", username);
      const found = resolveDay(username, args);
      const entry = found?.entry;
      const trip = found?.trip;

      const photoSrc = entry
        ? args.photo
          ? entry.gallery.find((item) => relativePhoto(trip!.id, item.src).endsWith(args.photo!))?.src
          : entry.gallery[0]?.src
        : undefined;
      const photo = entry && trip && photoSrc ? relativePhoto(trip.id, photoSrc) : "";

      const recipients = [
        ...new Set(
          (args.recipients ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      const each = POSTCARD_CREDITS;
      const total = each * Math.max(recipients.length, 1);
      const metered = creditsEnabled();
      const balance = metered ? await balanceOf(username) : null;

      const sentence = !entry
        ? say("agent.tool.publishNoDay")
        : metered
          ? say("agent.tool.proposePostcards", {
              count: String(Math.max(recipients.length, 1)),
              date: entry.date,
              title: entry.title,
              each: String(each),
              total: String(total),
              balance: String(balance ?? 0),
            })
          : say("agent.tool.proposePostcardsFree", {
              count: String(Math.max(recipients.length, 1)),
              date: entry.date,
              title: entry.title,
            });

      return {
        ...(unavailable
          ? { refuse: "agent.tool.postcardsUnavailable" }
          : entry && trip && isTestContent(trip, entry)
            ? { refuse: "agent.tool.postcardsTestDay" }
            : entry && !photo
              ? { refuse: "agent.tool.postcardsNoPhoto" }
              : {}),
        sentence,
        accept: say("agent.tool.proposePostcardsAccept"),
        done: say("agent.tool.proposePostcardsDone"),
        preview: entry ? [entry.date, entry.title, args.message ?? ""].filter((line) => line !== "") : [],
        fields: [
          { name: "trip", value: tripIdFor(username, args, found), fixed: true },
          { name: "slug", value: entry?.slug ?? args.slug ?? "", fixed: true },
          { name: "photo", value: photo },
          { name: "message", value: args.message ?? "", long: true },
          { name: "from", value: args.from ?? "" },
          { name: "recipients", value: recipients.join(",") },
          { name: "locale", value: args.locale ?? "" },
        ],
      };
    },
  },
  {
    /**
     * The photobook — the same shape as `propose_postcards` a level further
     * out. There is no order to write ahead of the maker: planning a book,
     * pricing it and paying for it are one page and one press
     * (`app/[user]/photobook/order/route.ts`), so this tool's whole job is to
     * ask the two questions that page would otherwise ask badly out of a
     * blank state, and hand over its URL.
     */
    name: "photobook",
    kind: "write",
    renders: "form",
    describe:
      "Propose printing a trip into a photobook: which trip, and roughly what shape — soft or hard cover, which size. Nothing is built or charged here; this hands over the link to their own photobook maker, where the pages are laid out, priced and paid for.",
    properties: {
      ...TRIP_ARG,
      size: {
        type: "string",
        description: `The book's shape, one of: ${Object.keys(BOOK_SIZES).join(", ")}. Omit for the square one.`,
      },
      cover: {
        type: "string",
        description: `Soft or hard cover — one of: ${COVER_TYPES.join(", ")}. Omit for soft.`,
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/photobook`,
    propose: async (username, args, say) => {
      // Absent rather than broken, the same reasoning as `propose_postcards`
      // above: `refuse` (B951) declines with a sentence and no button,
      // computed alongside the rest of `Proposed` rather than instead of it.
      const unavailable = !isEnabled("photobook", username);
      const trip = resolveTrip(username, args.trip);
      const sizeId = args.size && BOOK_SIZES[args.size] ? args.size : "square";
      const size = BOOK_SIZES[sizeId];
      const cover: CoverType =
        args.cover === "hard" || args.cover === "soft"
          ? size.covers[args.cover]
            ? args.cover
            : ((Object.keys(size.covers)[0] ?? "soft") as CoverType)
          : ((Object.keys(size.covers)[0] ?? "soft") as CoverType);

      return {
        ...(unavailable ? { refuse: "agent.tool.photobookUnavailable" } : {}),
        sentence: trip
          ? say("agent.tool.photobook", {
              trip: trip.title,
              size: size.name,
              cover: say(cover === "hard" ? "agent.tool.coverHard" : "agent.tool.coverSoft"),
            })
          : say("agent.tool.noTrip"),
        accept: say("agent.tool.photobookAccept"),
        done: say("agent.tool.photobookDone"),
        fields: [
          { name: "trip", value: trip?.id ?? "", fixed: true },
          {
            name: "size",
            value: sizeId,
            options: Object.values(BOOK_SIZES).map((one) => ({ value: one.id, label: one.name })),
          },
          {
            name: "cover",
            value: cover,
            options: (COVER_TYPES as readonly CoverType[])
              .filter((one) => size.covers[one])
              .map((one) => ({
                value: one,
                label: say(one === "hard" ? "agent.tool.coverHard" : "agent.tool.coverSoft"),
              })),
          },
        ],
      };
    },
  },
  {
    name: "print_order",
    kind: "read",
    renders: "say",
    describe:
      "Where one postcard or photobook order stands: its status, and whether anything has gone to the printer yet. Needs the order's own id, which a proposal answers with once it is pressed — never invent one.",
    properties: {
      id: { type: "string", description: "The order's id, as it was answered when it was proposed." },
    },
    run: async (username, args) => {
      const id = args.id ?? "";
      if (!id) return { found: false, why: "no order id was given" };
      if (isEnabled("postcards", username)) {
        const order = await getOrder(username, id);
        if (order) {
          return {
            found: true,
            kind: "postcard",
            status: order.status,
            recipients: order.payload.recipients.length,
            credits: { each: order.payload.creditsEach, total: orderCost(order) },
            printed: order.payload.results?.filter((r) => r.ok).length ?? 0,
          };
        }
      }
      if (isEnabled("photobook", username)) {
        const order = await getPhotobookOrder(username, id);
        if (order) {
          return {
            found: true,
            kind: "photobook",
            status: order.status,
            pages: order.payload.pages,
            ...(order.payload.print ? { quotedCredits: order.payload.print.quotedCredits } : {}),
          };
        }
      }
      return { found: false, why: "no order of that id in this journal" };
    },
  },
];
