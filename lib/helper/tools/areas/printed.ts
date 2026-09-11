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
import { ineligibleCounts, postcardCandidates, type IneligibleCounts } from "../../../postcard/contacts";
import { openingOf } from "../../../postcard/opening";
import { getPhotobookOrder } from "../../../photobook/orders";
import { BOOK_SIZES, COVER_TYPES, type CoverType } from "../../../photobook/spec";
import { findInboxFile } from "../../../inbox";
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
        return { available: false, recipients: [], ineligible: null };
      }
      const recipients = await postcardCandidates(username);
      // B1399 — only computed when it is actually needed for the answer:
      // which contact is short of what, as counts, never a name.
      const ineligible = recipients.length === 0 ? await ineligibleCounts(username) : null;
      return { available: true, recipients, ineligible };
    },
    block: (data, say) => {
      const result = data as {
        available: boolean;
        recipients: { contactId: string; name: string; city: string; country: string | null }[];
        ineligible: IneligibleCounts | null;
      };
      if (!result.available) return null;
      if (result.recipients.length === 0) {
        const counts = result.ineligible;
        const total = counts ? counts.notActive + counts.noAddress + counts.noConsent : 0;
        // B1399 — a contact exists and is short of something, which is a
        // different, more actionable truth than nobody having asked at all.
        if (counts && total > 0) {
          const parts = [
            counts.notActive > 0
              ? say("postcard.ineligible.notActive", { count: String(counts.notActive) })
              : null,
            counts.noAddress > 0
              ? say("postcard.ineligible.noAddress", { count: String(counts.noAddress) })
              : null,
            counts.noConsent > 0
              ? say("postcard.ineligible.noConsent", { count: String(counts.noConsent) })
              : null,
          ].filter((part): part is string => part !== null);
          return {
            shape: "say",
            text: say("agent.block.postcardIneligible", {
              parts: parts.join(", "),
              page: say("contact.adminTitle"),
              nav: say("me.title"),
            }),
          };
        }
        // B1280 — the truth, drawn rather than left to the model's own prose:
        // nobody has asked yet, and the real page is named by its real name.
        // `postcard.noRecipients` already says the first half correctly in
        // all three locales; this only adds where that page actually is.
        return {
          shape: "say",
          text: say("agent.block.postcardNoRecipients", {
            base: say("postcard.noRecipients"),
            page: say("contact.adminTitle"),
            nav: say("me.title"),
          }),
        };
      }
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
      "Propose real postcards: a photo (day or inbox) and message, to recipients from postcard_recipients. A pending order; nothing charged or printed until pressed.",
    properties: {
      ...DAY_ARGS,
      photo: {
        type: "string",
        description:
          "A file name from read_day (on a day), or an inbox id (no day). Omit for what's ticked, or the first photo.",
      },
      message: {
        type: "string",
        description: "Exactly what they said for the back. Never invent.",
      },
      from: {
        type: "string",
        description: "The signature — how they sign it, e.g. their name.",
      },
      recipients: {
        type: "string",
        description: "Contact ids from postcard_recipients, comma separated. Never a name from memory.",
      },
      locale: {
        type: "string",
        description: "The card's language, if not the journal's default.",
      },
    },
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/postcard`,
    propose: async (username, args, say, _today, selected) => {
      // Absent rather than broken (AGENTS.md): the tool stays in the model's
      // list either way — filtering the registry per journal is not
      // structurally possible here (`TOOLS` is built once, with no
      // journal in view) — but `refuse` (B951) is the same effect from the
      // other side: no button reaches the screen, only a sentence saying
      // why, alongside the rest of `Proposed`'s required fields so the type
      // stays honest about what a declined proposal still carries.
      const unavailable = !isEnabled("postcards", username) || !isEnabled("contacts", username);

      /**
       * B1393 — the day is where a photograph is *found*, never something
       * the printer needs. When nothing names a day, a photograph staged in
       * the inbox — ticked in the files pane, or named by its own id — makes
       * the card instead, and `resolveDay` is never asked to guess one.
       */
      const dayNamed = !!(args.trip || args.slug || args.date);
      const namedInboxId =
        !dayNamed && args.photo && findInboxFile(username, args.photo)?.entry.kind === "media"
          ? args.photo
          : undefined;
      const tickedInboxId = dayNamed
        ? undefined
        : selected
            .filter((id) => id.startsWith("inbox:"))
            .map((id) => id.slice("inbox:".length))
            .find((id) => findInboxFile(username, id)?.entry.kind === "media");
      const inboxId = namedInboxId ?? tickedInboxId;

      const found = inboxId ? null : resolveDay(username, args);
      const entry = found?.entry;
      const trip = found?.trip;

      const photoSrc = entry
        ? args.photo
          ? entry.gallery.find((item) => relativePhoto(trip!.id, item.src).endsWith(args.photo!))?.src
          : entry.gallery[0]?.src
        : undefined;
      const photo = inboxId ?? (entry && trip && photoSrc ? relativePhoto(trip.id, photoSrc) : "");

      const requested = [
        ...new Set(
          (args.recipients ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      /**
       * **Only ids `postcard_recipients` actually offered — B1284.** The
       * description already said "look the id up first"; a live run sent
       * `"bea-muster"` instead — the name it had just shown the person,
       * slugified, never a `contactId` — and `POST .../postcard` refused
       * with `unknown_recipient` for every recipient, always. Rewording the
       * prompt is not the fix AGENTS.md asks for; filtering here is the same
       * guard `POST /<user>/postcards/<id>/recipients` already applies to a
       * human editing the same list by hand
       * (`test/postcard-recipients-route.test.ts`): drop what was never
       * offered, keep what was. The route still checks the same set on its
       * own — this is what stops a bad id from reaching it at all, and lets
       * the model be told why rather than getting back a bare error code.
       */
      const candidates = unavailable ? [] : await postcardCandidates(username);
      const validIds = new Set(candidates.map((c) => c.contactId));
      const recipients = requested.filter((id) => validIds.has(id));
      const unknownRecipients = requested.length > 0 && recipients.length === 0;
      // B1322 — the route refuses an empty `from` outright, and until now
      // nothing stopped the model proposing a card with one: it drew the
      // button straight from the raw refusal, which nobody reads as a
      // question. Ask for the signature in the room instead — the same shape
      // as the photo/recipient/test-day refusals above.
      const noSignature = (!!entry || !!inboxId) && !(args.from ?? "").trim();
      const each = POSTCARD_CREDITS;
      const total = each * Math.max(recipients.length, 1);
      const metered = creditsEnabled();
      const balance = metered ? await balanceOf(username) : null;

      const count = Math.max(recipients.length, 1);
      const sentence = inboxId
        ? metered
          ? say(
              count === 1 ? "agent.tool.proposePostcardsFromFile.one" : "agent.tool.proposePostcardsFromFile",
              { count: String(count), each: String(each), total: String(total), balance: String(balance ?? 0) },
            )
          : say(
              count === 1
                ? "agent.tool.proposePostcardsFromFileFree.one"
                : "agent.tool.proposePostcardsFromFileFree",
              { count: String(count) },
            )
        : !entry
          ? say("agent.tool.publishNoDay")
          : metered
            ? say(count === 1 ? "agent.tool.proposePostcards.one" : "agent.tool.proposePostcards", {
                count: String(count),
                date: entry.date,
                title: entry.title,
                each: String(each),
                total: String(total),
                balance: String(balance ?? 0),
              })
            : say(
                count === 1 ? "agent.tool.proposePostcardsFree.one" : "agent.tool.proposePostcardsFree",
                {
                  count: String(count),
                  date: entry.date,
                  title: entry.title,
                },
              );

      // The recipient's own language, when exactly one is known and nobody
      // said otherwise — the same idea `add_cost`'s currency guess is,
      // shown rather than silently substituted (B973's reasoning, one field
      // over): the model was leaving this "" and the route fell back to the
      // journal's own default locale instead of the person actually being
      // written to.
      const locale =
        args.locale ||
        (recipients.length === 1 ? candidates.find((c) => c.contactId === recipients[0])?.locale : null) ||
        "";

      return {
        ...(unavailable
          ? { refuse: "agent.tool.postcardsUnavailable" }
          : entry && trip && isTestContent(trip, entry)
            ? { refuse: "agent.tool.postcardsTestDay" }
            : entry && !photo
              ? { refuse: "agent.tool.postcardsNoPhoto" }
              : noSignature
                ? { refuse: "agent.tool.postcardsNoSignature" }
                : unknownRecipients
                  ? { refuse: "agent.tool.postcardsUnknownRecipient" }
                  : {}),
        sentence,
        accept: say("agent.tool.proposePostcardsAccept"),
        done: say("agent.tool.proposePostcardsDone"),
        preview: entry
          ? [entry.date, entry.title, args.message ?? ""].filter((line) => line !== "")
          : inboxId
            ? [args.message ?? ""].filter((line) => line !== "")
            : [],
        fields: [
          // Empty means "the inbox" — the route resolves `photo` against the
          // inbox rather than a trip's media whenever both are blank.
          { name: "trip", value: inboxId ? "" : tripIdFor(username, args, found), fixed: true },
          { name: "slug", value: inboxId ? "" : (entry?.slug ?? args.slug ?? ""), fixed: true },
          { name: "photo", value: photo },
          { name: "message", value: args.message ?? "", long: true },
          { name: "from", value: args.from ?? "" },
          { name: "recipients", value: recipients.join(",") },
          { name: "locale", value: locale },
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
  {
    /**
     * The owner, added as their own contact — B1393.
     *
     * "Add someone else" is out of scope on purpose: it would need an
     * address, and an address must never reach this conversation
     * (AGENTS.md). This one needs none — the name comes from `config.json`,
     * server-side, the same read `addSelfContact` always made, and the
     * address stays blank until the owner fills it in on their own page.
     */
    name: "add_contact",
    kind: "write",
    renders: "confirm",
    describe:
      "Add the owner as their own contact, from the journal's name. Needs an address still, added on the access page. Nobody else.",
    properties: {},
    endpoint: (username) => `/api/helper/${encodeURIComponent(username)}/contacts/add-me`,
    propose: async (username, _args, say) => ({
      ...(isEnabled("contacts", username) ? {} : { refuse: "agent.tool.contactsUnavailable" }),
      sentence: say("agent.tool.addContact"),
      accept: say("agent.tool.addContactAccept"),
      done: say("agent.tool.addContactDone"),
      fields: [],
    }),
  },
];
