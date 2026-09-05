import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, refund, spend } from "@/lib/credits";
import { parseOptions } from "@/lib/photobook/options";
import { buildPhotobook, followerNames, planFor, priceOf } from "@/lib/photobook/build";
import { ORDER_ID_RE, claimOrder, markFailed, markPrinted } from "@/lib/photobook/orders";
import { sendPhotobookReceipt } from "@/lib/photobook/receipt";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { getTrip, parseTripRef } from "@/lib/trips";

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
function back(user: string, tripId: string, state: string, extra?: Record<string, string>): Response {
  const query = new URLSearchParams({ state, ...extra });
  const location = `/${encodeURIComponent(user)}/trips/${encodeURIComponent(tripId)}/photobook?${query}`;
  return new Response(null, { status: 303, headers: { Location: location } });
}

/**
 * The button, and the only place in this codebase that spends credits on a
 * book.
 *
 * Claim, spend, build — in that order, and the order is the whole design.
 * Claiming first is what makes a double press cost one book: the order id
 * comes from the page as the row's primary key, so two presses race to insert
 * it and one loses. Spending before building is `lib/credits.ts`'s
 * all-or-nothing rule. Refunding after a failed build is the other half of it:
 * a book nobody got bought nothing.
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
  // `ORDER_ID_RE` here, before the id reaches anything that joins it into a
  // path — `claimOrder`, and later `buildPhotobook`/`orderDir` — is not
  // optional. `orderDir()` trusts the id it is given; this is the boundary
  // where an id arriving from a browser gets checked, once, for everyone
  // downstream.
  if (!parsed || parsed.username !== user || !options || !ORDER_ID_RE.test(orderId)) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const back_ = (state: string, extra?: Record<string, string>) => back(user, parsed.tripId, state, extra);

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
  const credits = priceOf(book, options);
  const payload = {
    trip,
    options,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    credits,
  };

  // 1. Claim. A second press finds the key taken and is told so.
  if (!(await claimOrder(user, orderId, payload))) return back_("duplicate");

  // 2. Spend, all of it, before a single page is drawn.
  if (!(await spend(user, credits, "photobook", orderId))) {
    // The order row stays `submitted` if this write races and loses — an
    // operator chasing a stuck row later, not a customer's problem now.
    await markFailed(user, orderId, payload, "no_credits");
    return back_("no_credits");
  }

  // 3. Build. Anything that goes wrong here gives the credits back. The
  // success path (marking the order printed, mailing the receipt, and the
  // redirect itself) happens after this block, precisely so that a `catch`
  // written to recover from a *build* failure can never fire on a success.
  let built: { files: string[]; pages: number; volumes: number; missing: string[] };
  try {
    built = buildPhotobook(user, orderId, trip, options, followers);
  } catch (error) {
    console.error(`[photobook] building ${orderId} failed:`, error);
    // The one branch where a failure costs the owner money: the build has
    // already failed, and now the database that would give the credits back
    // is unreachable too. Nested rather than left to escape — an uncaught
    // throw here would leave the row `submitted`, the balance down, and the
    // owner looking at whatever Next's default error page says, which is
    // nothing true about any of that. `refund_failed` says the one thing that
    // is true: something needs a person's attention, and pressing Pay again
    // is not it.
    try {
      await refund(user, credits, orderId);
      await markFailed(user, orderId, payload, String(error));
    } catch (refundError) {
      console.error(
        `[photobook] refund/markFailed for ${orderId} failed after a failed build:`,
        refundError,
      );
      return back_("refund_failed");
    }
    return back_("failed");
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

  // `missing` lists photographs the build could not read — pages that will
  // print as gaps in a book the owner has already paid for. That is not a
  // reason to fail the order (the rest of the book is real and the money is
  // spent), but it must reach the owner rather than be silently swallowed:
  // the receipt mail is the one place written for this owner to actually
  // read, so it carries the list there. `sendPhotobookReceipt` is best-effort
  // and never throws.
  await sendPhotobookReceipt({
    owner: user,
    orderId,
    tripTitle: getTrip(trip)?.title ?? parsed.tripId,
    pages: built.pages,
    volumes: built.volumes,
    creditsSpent: credits,
    balance: await balanceOf(user),
    files: built.files,
    missing: built.missing,
  });

  return back_("done", { order: orderId });
}
