import { isTestContent } from "@/lib/access";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { isOwner } from "@/lib/contacts/session";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import {
  channelEnabled,
  claimChannel,
  notifiedChannelsFor,
  releaseChannelClaim,
  type NotifyChannel,
} from "@/lib/digest/dayNotify";
import { mailWouldReach, sendDayLetter } from "@/lib/digest/dayLetter";
import {
  sendDayWhatsapp,
  whatsappWouldCost,
  whatsappWouldReach,
} from "@/lib/digest/dayWhatsapp";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The button on a day itself — B633, and the same door as the postcard send
 * button beside it (`app/[user]/postcards/[id]/send/route.ts`).
 *
 * `sendDayLetter` and `sendDayWhatsapp` (`lib/digest/`) already do the work;
 * what did not exist was a way for the owner to press "send" while looking at
 * the day, see what it costs first, and see afterwards that it already went.
 * This is that door, not a third notification system:
 *
 * - **Not under `/api/v1/`.** An agent already has `POST …/send-mail` and
 *   `…/send-whatsapp` to ask for a send (`/agent.md`) — this route is not a
 *   second way to reach the same thing, it is the one the person whose
 *   journal it is presses themselves.
 * - **The owner's cookie only.** `isOwner` is called *without* the request —
 *   the same difference that matters on the postcard route — and a request
 *   carrying `Authorization` is refused outright rather than falling through.
 * - **Quotes before it spends.** `GET` answers what pressing the button would
 *   cost and what is left after, without sending anything; `POST` refuses
 *   outright, spending nothing, if the balance is short of that.
 */

type StatusError = "unknown_trip" | "unknown_day" | "not_published" | "test_content";

/** One channel a press of the button would use, and what it would do — B1024.
 *  Before this the route answered with bare channel names, so the panel could
 *  quote a price and could not say who was about to be written to. */
type PendingChannel = { channel: NotifyChannel; count: number; cost: number };

type Status =
  | { error: StatusError }
  | {
      ref: string;
      trip: Trip;
      /** Channels not yet notified *and* actually switched on for this
       * journal — the ones a press of the button would try. Empty means
       * either everything reachable has already been told, or nothing is
       * reachable at all; the two are told apart by `reachable` below.
       *
       * Each carries what pressing the button would do on that channel —
       * B1024. `count` is how many messages go out, `cost` is what they come
       * to; for WhatsApp the two differ by the owner's own free copy, which
       * is a message nobody is charged for. The panel needs both, and the
       * server has already worked both out to answer `needed`. */
      pending: PendingChannel[];
      /** Whether any channel is configured for this journal at all — false
       * means there is nothing this button could ever do, whatever is
       * notified, and the page should show no button rather than a dead
       * one. */
      reachable: boolean;
      needed: number;
      balance: number | null;
      short: boolean;
    };

async function statusFor(owner: string, tripParam: string, slug: string): Promise<Status> {
  const ref = tripRef(owner, tripParam);
  const trip = getTrip(ref);
  if (!trip) return { error: "unknown_trip" };

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return { error: "unknown_day" };
  if (entry.draft) return { error: "not_published" };
  if (isTestContent(trip, entry)) return { error: "test_content" };

  const CHANNELS: NotifyChannel[] = ["mail", "whatsapp"];
  const reachable = CHANNELS.some((c) => channelEnabled(c, owner));
  const already = await notifiedChannelsFor(owner, trip.id, slug);
  const pending = CHANNELS.filter((c) => !already.has(c) && channelEnabled(c, owner));

  // Mail was a term in this sum until B840; a letter costs nothing now, so
  // what the button quotes is the WhatsApp half or nothing at all.
  const detailed: PendingChannel[] = await Promise.all(
    pending.map(async (channel) =>
      channel === "whatsapp"
        ? {
            channel,
            count: await whatsappWouldReach(owner, ref, slug),
            cost: await whatsappWouldCost(owner, ref, slug),
          }
        : { channel, count: await mailWouldReach(owner, ref, slug), cost: 0 },
    ),
  );
  const needed = detailed.reduce((sum, c) => sum + c.cost, 0);
  const balance = creditsEnabled() ? await balanceOf(owner) : null;

  return {
    ref,
    trip,
    pending: detailed,
    reachable,
    needed,
    balance,
    short: balance !== null && needed > balance,
  };
}

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This day is announced by the person whose journal it is, from the day itself, and never " +
    "by an agent holding a token. Ask them, in words, whether to send it — the same as any " +
    "other publish — and use POST …/send-mail or …/send-whatsapp if they say yes.",
};

function statusCode(reason: StatusError): number {
  return reason === "unknown_trip" || reason === "unknown_day" ? 404 : 409;
}

/**
 * This answer is one owner's, and it carries their balance — B1042.
 *
 * The same header every other owner-only route under `app/[user]/` sends, and
 * it was the only one not sending it. The omission was invisible until the
 * shape of `pending` changed: the service worker's runtime cache had been
 * handing back the previous build's answer, and a compatible old shape never
 * looked wrong on screen. `public/sw.js` now reads this header rather than
 * guessing from the path, so saying it here is what keeps the response out of
 * the cache.
 */
const PRIVATE = { "Cache-Control": "private, no-store" } as const;

export async function GET(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/notify">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip, slug } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const status = await statusFor(user, trip, slug);
  if ("error" in status) {
    return Response.json(
      { error: status.error },
      { status: statusCode(status.error), headers: PRIVATE },
    );
  }

  return Response.json(
    {
      ok: true,
      reachable: status.reachable,
      alreadySent: status.reachable && status.pending.length === 0,
      pending: status.pending,
      needed: status.needed,
      balance: status.balance,
      short: status.short,
    },
    { headers: PRIVATE },
  );
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/notify">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip, slug } = await params;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const status = await statusFor(user, trip, slug);
  if ("error" in status) {
    return Response.json({ error: status.error }, { status: statusCode(status.error) });
  }

  // Nothing left to send — an owner who presses the button twice, or two
  // tabs open on the same day, changes nothing and spends nothing.
  if (status.pending.length === 0) {
    return Response.json({ ok: true, alreadySent: true });
  }

  // The precheck — B366's rule restated for one button: refuse before
  // spending anything, never discover the shortfall mid-send.
  if (status.short) {
    return Response.json(
      {
        error: "no_credits",
        needed: status.needed,
        balance: status.balance,
        message:
          `Sending this day would take ${status.needed} credit(s); this journal has ` +
          `${status.balance} left. Nothing was sent.`,
      },
      { status: 402 },
    );
  }

  /*
   * Claim each channel before sending it — the double-press guard.
   *
   * Two POSTs a heartbeat apart both run `statusFor` above and both see
   * "mail" as pending, both pass the credit precheck, and both would
   * otherwise call `sendDayLetter` — spending twice and mailing the whole
   * readership twice, which is exactly the failure this button exists to
   * rule out (`lib/digest/dayNotify.ts`'s `claimChannel` doc comment has the
   * full reasoning, and it is `claimForSend` in `lib/postcard/orders.ts`'s
   * own pattern). Only the request that wins the claim on a given channel
   * sends it; the other finds the channel already taken and moves on.
   */
  const result: Record<string, unknown> = {};
  for (const { channel } of status.pending) {
    if (!(await claimChannel(user, status.trip.id, slug, channel))) continue;

    if (channel === "mail") {
      const outcome = await sendDayLetter(user, status.ref, slug);
      if (!outcome.ok) await releaseChannelClaim(user, status.trip.id, slug, channel);
      result.mail = mailSummary(outcome);
    } else {
      const outcome = await sendDayWhatsapp(user, status.ref, slug);
      if (!outcome.ok) await releaseChannelClaim(user, status.trip.id, slug, channel);
      result.whatsapp = whatsappSummary(outcome);
    }
  }

  return Response.json({ ok: true, ...result });
}
