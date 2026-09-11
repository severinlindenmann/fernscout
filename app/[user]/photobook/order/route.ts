import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, spend } from "@/lib/credits";
import { parseOptions } from "@/lib/photobook/options";
import { buildPhotobook, followerNames, planFor } from "@/lib/photobook/build";
import { quoteBookFor } from "@/lib/photobook/quote";
import { submitBuiltBook } from "@/lib/photobook/print";
import { nowIso } from "@/lib/db";
import {
  ORDER_ID_RE,
  claimOrder,
  markFailed,
  markPrinted,
  type PhotobookOutcomeState,
} from "@/lib/photobook/orders";
import { pruneOldPhotobooks } from "@/lib/photobook/retention";
import { sendPhotobookReceipt, sendPhotobookRefused } from "@/lib/photobook/receipt";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { storageRefusal } from "@/lib/storageQuota";
import { getTrip, parseTripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";
import { translateIn } from "@/lib/locales";
import { pickLocale } from "@/lib/contacts/locale";

export const dynamic = "force-dynamic";

/**
 * Back to the preview page, as a relative `Location` — the same B460 reasoning
 * as `lib/postcard/redirectBack.ts`: an absolute URL built from `request.url`
 * is the app's own address behind a reverse proxy, not the browser's, and a
 * `<form action>` posting cross-origin is exactly what `form-action 'self'`
 * then (correctly) blocks. A relative one is followed on whatever origin the
 * reader is actually on.
 *
 * This is also how the redirect-inside-`try` hazard the brief warns about is
 * avoided rather than worked around: nothing here calls Next's `redirect()`,
 * which works by throwing, so there is no thrown value a `catch` meant for
 * build failures could ever intercept. `303` so a reload of the result page
 * cannot repost the form and pay twice.
 */
function back(
  user: string,
  tripId: string,
  state: PhotobookOutcomeState,
  extra?: Record<string, string>,
): Response {
  const query = new URLSearchParams({ state, ...extra });
  const location = `/${encodeURIComponent(user)}/trips/${encodeURIComponent(tripId)}/photobook?${query}`;
  return new Response(null, { status: 303, headers: { Location: location } });
}

/**
 * The button, and the only place in this codebase that spends credits on a
 * book.
 *
 * **One press buys a printed book** — B1157. Quote, claim, build, spend,
 * print, and the order is the whole design. It used to stop after the build
 * and hand back two PDFs, with printing sold separately on another page for
 * more money; the owner's word for that was that it made no sense, and they
 * were right. What is for sale is the object. The files come with it.
 *
 * Claiming first is what makes a double press cost one book: the order id
 * comes from the page as the row's primary key, so two presses race to insert
 * it and one loses. Everything that can refuse for free — a missing recipient,
 * an unreachable printer, a stale price — is checked above the claim, so a
 * refusal costs nothing and pressing again after fixing it works.
 *
 * Not under `/api/v1/`, `isOwner` called without the request, bearer refused
 * outright — see `app/[user]/postcards/[id]/send/route.ts` for why each of the
 * three matters.
 */
export async function POST(request: Request, { params }: RouteContext<"/[user]/photobook/order">) {
  const { user } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Ordering a photobook spends the owner's credits and is done by the owner, from " +
          "their own page. Nothing has been built or charged.",
      },
      { status: 403 },
    );
  }
  if (!isEnabled("photobook", user) || !isEnabled("credits") || !(await isOwner(user))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const form = await request.formData();
  const trip = String(form.get("trip") ?? "");
  const orderId = String(form.get("orderId") ?? "");
  // Parsed the same guarded way `preview/route.ts` parses its JSON body — a
  // malformed field used to reach `JSON.parse` unguarded and turn into a 500,
  // where the sibling route already answered a clean 400 for the same input.
  let optionsInput: unknown = null;
  try {
    optionsInput = JSON.parse(String(form.get("options") ?? "null"));
  } catch {
    optionsInput = null;
  }
  const options = parseOptions(optionsInput, Object.keys(BOOK_SIZES));
  const parsed = parseTripRef(trip);
  // What `preview/route.ts` last quoted this page, in credits — B595. Not
  // trusted as the price to charge; only as the number to check a fresh
  // quote against below, so a caller cannot lower their own price by
  // sending a smaller one. A missing or non-numeric value fails that check
  // exactly like a mismatch: there is no previewed price to have agreed with.
  const previewedCreditsRaw = form.get("previewedCredits");
  const previewedCredits =
    typeof previewedCreditsRaw === "string" && previewedCreditsRaw.trim() !== ""
      ? Number(previewedCreditsRaw)
      : NaN;
  // `ORDER_ID_RE` here, before the id reaches anything that joins it into a
  // path — `claimOrder`, and later `buildPhotobook`/`orderDir` — is not
  // optional. `orderDir()` trusts the id it is given; this is the boundary
  // where an id arriving from a browser gets checked, once, for everyone
  // downstream.
  if (!parsed || parsed.username !== user || !options || !ORDER_ID_RE.test(orderId)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const back_ = (state: PhotobookOutcomeState, extra?: Record<string, string>) =>
    back(user, parsed.tripId, state, extra);

  // A stale page (the trip was deleted mid-session) or a malformed ref that
  // happened to parse throws here — the same case `preview/route.ts` guards
  // against with the same answer, rather than a 500 upstream of any money
  // moving.
  // Fetched once and reused for the build below, so the book somebody is
  // charged for is the book that was planned and priced — not one that grew a
  // page because a contact was approved in between.
  const followers = await followerNames(user);
  let book;
  try {
    book = planFor(trip, options, followers);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // `preview/route.ts` already refuses to call a photograph-less book
  // `buyable`, and the page disables Pay on that answer — but nothing here
  // re-checked it, so a stale tab (a preview loaded before every photograph
  // was excluded, or the trip emptied in another tab) could still post the
  // form and pay real credits for a padded, text-only book. Checked again
  // here, before an order is even claimed, so nothing is charged — B482.
  if (book.photoCount === 0) {
    return back_("no_photos");
  }

  /**
   * The owner is charged exactly the price their own screen showed them, or
   * not charged at all — B595.
   *
   * `preview/route.ts` plans and prices the same way this route does, from
   * the same `trip` and `options` the form below carries back — but between
   * that response rendering and this press, the trip on disk can change: a
   * day published, a photograph added, kept-original pages toggled. Re-
   * planning here (above) and pricing again is therefore not guaranteed to
   * agree with what was quoted, and paying the new number without having
   * seen it is exactly what B595 is about.
   *
   * So the previewed price travels with the form (`previewedCredits`,
   * `BookLevelView.tsx`) and is compared against a fresh quote on *this*
   * plan before anything is claimed or spent. Three ways this can fail, and
   * all three answer the same `stale_preview` rather than a guess: the field
   * is missing (an old tab, or a form built by hand), the trip changed and
   * the number no longer matches, or — the same thing from the other side —
   * the plan itself is stale. The page's own answer to all three is to ask
   * for the preview again, which quotes the real, current price.
   */
  /**
   * What the book costs, posted to the person named on the panel — B1157.
   *
   * One product and one price: building the PDF and printing the object are
   * two costs and a single purchase. `quoteBookFor` is the same function the
   * preview called to put a number on the button, so the check below compares
   * like with like; it re-quotes rather than trusting the form, because
   * postage is most of the difference between a cheap book and an expensive
   * one and a stale quote is somebody else paying it.
   *
   * A refusal here costs nothing — nothing is claimed, built or spent yet.
   *
   * `quote.totalCredits` is the whole price — B1425. There is no build/print
   * split left to name a "print portion" from, so the same single number is
   * what is charged and what is frozen onto the order below.
   */
  const contactId = String(form.get("contactId") ?? "").trim();
  if (!contactId) return back_("no_recipient");

  const quote = await quoteBookFor(user, book, options, contactId);
  if ("error" in quote) {
    if (quote.error !== "provider_unavailable") return back_("no_recipient");
    // B1148. `quote.kind` is the real GelatoFailure: `unreachable` is
    // weather and keeps the retry-friendly message; `no_key` / `refused` is
    // the printer refusing this server's own account, which pressing again
    // cannot fix.
    return back_(quote.kind === "unreachable" ? "printer_unavailable" : "printer_refused");
  }

  const currentCredits = quote.totalCredits;
  if (!Number.isFinite(previewedCredits) || previewedCredits !== currentCredits) {
    return back_("stale_preview");
  }

  /**
   * A full journal cannot be printed into — B661.
   *
   * The PDFs land under `content/<user>/photobooks/`, are tens to hundreds of
   * megabytes, and were outside every ceiling this instance had. Checked
   * before the order is claimed and before anything is charged, so a refusal
   * costs nothing and pressing the button again after deleting something
   * works.
   *
   * Asked about one byte rather than an estimate of the book: its size is
   * only known once it is rendered, and a guess would refuse the wrong
   * orders. "Is there room for anything at all" is the question that can be
   * answered honestly here.
   */
  if (await storageRefusal(user, 1)) {
    return back_("no_room");
  }

  const credits = currentCredits;
  const payload = {
    trip,
    options,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    credits,
    // Who it is for, and the postage the price was quoted with, written before
    // a single page is drawn — B1157. The book is bought printed and posted,
    // so the address is part of the order rather than something added to it
    // afterwards.
    print: {
      contactId,
      quotedCredits: quote.totalCredits,
      quotedAt: nowIso(),
      shipmentMethodUid: quote.shipmentMethodUid,
      quotedMinor: quote.quotedMinor,
      quotedCurrency: quote.quotedCurrency,
      // Bought, not proposed — B1164. `credits` above already includes the
      // print, so nothing may charge for it a second time.
      paid: true,
    },
  };

  // 1. Claim. A second press finds the key taken and is told so.
  if (!(await claimOrder(user, orderId, payload))) return back_("duplicate");

  /**
   * 2. Build, **before any money moves** — B509.
   *
   * This used to spend first, on the reasoning that a book must not be printed
   * for free. The reasoning was sound and the ordering was not: building takes
   * tens of seconds and hundreds of megabytes of JPEG copying, and anything
   * that ends the request in that window — a deploy restarting the service, a
   * proxy timeout, an OOM — took the credits and left no book, no receipt and
   * no refund, because the code that would have given the money back died with
   * the request. It happened twice on the live instance in one afternoon and
   * cost 357 credits.
   *
   * Reversed, the worst case is a book nobody was charged for: some seconds of
   * CPU and a directory to clean up, against somebody's money. The balance is
   * checked below before a single page is drawn, so a build is only wasted
   * when a balance changes underneath one — which needs two of the owner's own
   * sessions racing, and costs them nothing when it happens.
   */
  const balanceBefore = await balanceOf(user);
  if (balanceBefore !== null && balanceBefore < credits) {
    await markFailed(user, orderId, payload, "no_credits");
    return back_("no_credits");
  }

  let built: { files: string[]; pages: number; volumes: number; missing: string[] };
  try {
    built = await buildPhotobook(user, orderId, trip, options, followers);
  } catch (error) {
    console.error(`[photobook] building ${orderId} failed:`, error);
    // Nothing has been charged, so there is nothing to give back. The row is
    // marked so an operator can see the attempt rather than a gap.
    await markFailed(user, orderId, payload, String(error)).catch(() => {});
    return back_("failed");
  }

  /**
   * 3. Spend, now that the book exists.
   *
   * `spend` is all-or-nothing and returns `false` rather than throwing when
   * the balance will not cover it. That can only happen here if the balance
   * moved between the check above and this line; the book is already built, so
   * the honest answer is to keep the files, mark the order, and tell the owner
   * their balance is short — pressing Pay again after topping up costs nothing
   * extra, because the id is the same and the files are already there.
   */
  if (!(await spend(user, credits, "photobook", orderId))) {
    await markFailed(user, orderId, payload, "no_credits");
    return back_("no_credits");
  }

  // `markPrinted` returns `false` when the row had already left `submitted` —
  // a second build finishing after a first (there is only ever one build per
  // order, so this would mean a bug) or a failure notice landing after this
  // one already marked it printed. Either way the files on disk are real and
  // paid for, so this still redirects as a success; the mismatch is logged
  // for whoever reconciles the order table, not surfaced to the owner as an
  // error about a book that in fact exists.
  if (!(await markPrinted(user, orderId, { ...payload, files: built.files }))) {
    console.warn(`[photobook] ${orderId} built but was not in 'submitted' when marked printed`);
  }

  /**
   * 4. Send it to the printer — B1157.
   *
   * The whole point of the press. It runs after the spend because the book has
   * to exist and be paid for before it can be printed, and it refunds *the
   * whole amount* rather than the print half when Gelato refuses: what was
   * bought is a printed book, so a pile of PDFs is not a partial delivery of
   * it. `submitBuiltBook` owns that, and the files stay on disk either way.
   *
   * A refusal still redirects to `done`, not to `failed`: the order exists,
   * the receipt is real and the money is back. The order page is where the
   * refusal and the retry live, because that is the page that knows what the
   * printer said.
   */
  const printed = await submitBuiltBook(user, orderId);
  if (!printed.ok) {
    console.warn(`[photobook] ${orderId} built and paid, printer refused: ${printed.reason}`);
  }

  // B483: this order is the newest `printed` one for this owner, so it is
  // never among the ones this deletes — only older orders past the kept
  // count lose their PDFs. Best-effort: a failure here is a disk that grows
  // a little more, not a book this owner did not get.
  await pruneOldPhotobooks(user).catch((error) => {
    console.error(`[photobook] pruning old orders for ${user} failed:`, error);
  });

  /**
   * The mail, and **which** mail — B1330.
   *
   * The receipt is for a book that is actually being printed: it carries the
   * PDFs, because those are the files of an object on its way. It used to be
   * sent whatever the printer said, so a refused, refunded order still got
   * "thank you, your photobook is ready" with two download links attached —
   * which reads as "here is what you paid for" over a purchase that was given
   * back.
   *
   * A refusal gets its own mail instead, with no links: sorry, the money is
   * back, here is the reference, try again or write to us.
   *
   * `missing` lists photographs the build could not read — pages that print as
   * gaps in a book already paid for. Not a reason to fail the order, and it
   * must not be swallowed either, so the receipt carries it. Both senders are
   * best-effort and neither throws.
   */
  if (!printed.ok) {
    await sendPhotobookRefused({
      owner: user,
      orderId,
      tripTitle: getTrip(trip)?.title ?? parsed.tripId,
      creditsRefunded: credits,
    });
    return back_("print_refused", { order: orderId });
  }

  await sendPhotobookReceipt({
    owner: user,
    orderId,
    tripTitle: getTrip(trip)?.title ?? parsed.tripId,
    pages: built.pages,
    volumes: built.volumes,
    // B1227. What was actually bought, in the owner's own language — the two
    // facts a person checks a parcel against. Translated here because the
    // receipt has a locale and the size table does not.
    size: BOOK_SIZES[options.size]?.name ?? options.size,
    cover: translateIn(
      pickLocale(getUser(user)?.defaultLocale),
      options.coverType === "hard" ? "photobook.cover.hard.name" : "photobook.cover.soft.name",
    ),
    creditsSpent: credits,
    balance: await balanceOf(user),
    files: built.files,
    missing: built.missing,
  });

  // A finished order goes straight to its own receipt page rather than back
  // through the trip's photobook panel — B1365. Same relative-URL/303
  // reasoning as `back()`: a caller on the app's own origin behind a reverse
  // proxy, not the browser's.
  return new Response(null, {
    status: 303,
    headers: { Location: `/${encodeURIComponent(user)}/photobooks/${orderId}` },
  });
}
