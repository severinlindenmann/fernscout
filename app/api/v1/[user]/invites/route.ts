import { isEmail } from "@/lib/auth";
import { isEnabled } from "@/lib/capabilities";
import {
  createInvite,
  inviteExpiry,
  inviteLinkUrl,
  listInvites,
  type Invite,
  type InviteKind,
} from "@/lib/contacts/invites";
import { pickLocale } from "@/lib/contacts/locale";
import { mailFailedNote } from "@/lib/contacts/inviteMailNote";
import { sendInviteMail } from "@/lib/contacts/mail";
import { isOwner } from "@/lib/contacts/session";
import { serverSite } from "@/lib/site";
import { getTrip, tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The links an owner hands to other people — B33.
 *
 * Before this, a journal could be shared exactly two ways: a password typed
 * into a form, which everyone who ever received it holds forever and which can
 * only be revoked by cutting off everybody at once; or a person opening
 * `trip.md` in an editor and typing a name into `people:`. Neither is
 * something you can put in a message, and the person a journal is written for
 * is often somebody who has never seen the folder.
 *
 * Two kinds, at two URLs that say which is which:
 *
 * - **guest** — leads to being let into the *journal*: every trip in it marked
 *   `visibility: guest`, and nothing marked `private`. Journal-wide, because a
 *   guest is a guest of the journal and never of one trip (B41). There is no
 *   per-trip guest link and none should be added.
 * - **buddy** — leads to being on one *trip*: writing to it, and holding an
 *   agent token scoped to it and to nothing else. Stronger, and named so in
 *   every document that mentions it.
 *
 * **Neither link grants anything.** Redeeming one writes a `pending` contact
 * and waits for the owner, exactly as the existing personal invite does
 * (decision 19). That is what makes both safe to forward: the link decides who
 * may *ask*, and the owner decides who gets in.
 *
 * **Naming `email` here changes that, on purpose — B319.** The owner is no
 * longer handing over a link for someone to open eventually; they are typing
 * an address and asking this server to mail it. That is the owner vouching
 * for the address, so `createInvite` records it and the confirming routes
 * (`/api/contacts/confirm`, `/api/contacts/redeem`) skip the queue for
 * *exactly* that address once it is proved — see `preapprovedEmailFor`.
 * Proof is still required and still the reader's own to give; only the
 * owner's queue is skipped, and only for the address the owner actually typed.
 * A link sent this way is not thereby unsafe to forward too — a different
 * address that redeems it still asks, precisely as before.
 *
 * A failed send does not fail this call: `sendInviteMail` is best effort
 * (B272), and the link and its pre-approval both already exist by the time it
 * runs. `sent` in the response says whether the mail actually left; the owner
 * still has `invite.url` to send another way if it did not.
 *
 * ## Who may create one
 *
 * The journal's owner, and nobody else — including for a buddy link to a trip
 * somebody else is on. B33 left that open and this is the answer, for three
 * reasons. The queue a redemption lands in is the *owner's*, and B37 removed
 * the open guestbook precisely because a journal should not put decisions
 * about strangers in front of its owner. Approving a buddy also lets that
 * person read the journal's `guest` trips, which is not a companion's to
 * offer. And `POST /api/v1/{user}/trips` already draws this line in the same
 * place: a trip-scoped token writes days into its trip and cannot conjure
 * things beside it. Writing in somebody's book is not inviting people to it.
 *
 * ## Authenticated two ways, on purpose
 *
 * `isOwner` accepts the owner's **agent bearer token** or their **guest
 * cookie** — the two credentials decision 24 gives them, both legitimately
 * theirs. The cookie matters because the copy-a-link control this endpoint
 * exists for lives on a page the owner is reading in a browser (B79), and the
 * cookie is `SameSite=lax`, so a cross-site POST does not carry it. It is the
 * same guard `/api/contacts/admin` has always used.
 */

function view(username: string, invite: Invite, token?: string) {
  return {
    id: invite.id,
    kind: invite.kind,
    // The journal, or a trip ref. A trip id alone addresses nothing: ids are
    // unique within a user and not across the instance.
    scope: invite.tripId ? tripRef(username, invite.tripId) : username,
    trip: invite.tripId,
    name: invite.name,
    locale: invite.locale,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    uses: invite.uses,
    // Present exactly once, in the answer to the POST that made it. Only the
    // hash was stored, so a link that is lost is reissued, never looked up.
    ...(token ? { url: inviteLinkUrl(serverSite().url, username, invite.kind, token) } : {}),
  };
}

async function guard(username: string, request: Request): Promise<Response | null> {
  if (!getUser(username) || !isEnabled("contacts", username)) {
    return Response.json(
      {
        error: "contacts_disabled",
        message:
          "This journal does not have contacts switched on, so it has nobody to invite and " +
          "no queue for a redemption to land in. /api/health says which capabilities are on.",
      },
      { status: 404 },
    );
  }
  if (!(await isOwner(username, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may issue invite links — not a token " +
          "scoped to one of its trips. Handing out invitations and writing days into a " +
          "trip are different authorities.",
      },
      { status: 403 },
    );
  }
  return null;
}

/** Every link this journal has issued. Never the tokens: only hashes were
 * stored, so this says what exists and not how to use it. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/invites">) {
  const { user } = await params;
  const denied = await guard(user, request);
  if (denied) return denied;

  return Response.json({
    user,
    invites: (await listInvites(user)).map((invite) => view(user, invite)),
  });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/invites">) {
  const { user } = await params;
  const denied = await guard(user, request);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const raw = typeof body.kind === "string" ? body.kind : "";
  if (raw !== "guest" && raw !== "buddy") {
    return Response.json(
      {
        error: "invalid_request",
        message:
          'Say which kind of link: {"kind": "guest"} to let somebody into the journal, or ' +
          '{"kind": "buddy", "trip": "<trip-id>"} to put them on one trip. A buddy link ' +
          "leads to write access; it is not the one to paste into a group chat.",
      },
      { status: 400 },
    );
  }
  const kind: InviteKind = raw;

  const tripId = typeof body.trip === "string" ? body.trip.trim() : "";
  let tripTitle: string | null = null;
  if (kind === "buddy") {
    if (!tripId) {
      return Response.json(
        {
          error: "invalid_request",
          message: 'A buddy link is a link to join one trip, so it needs {"trip": "<trip-id>"}.',
        },
        { status: 400 },
      );
    }
    const trip = getTrip(tripRef(user, tripId));
    if (!trip) {
      return Response.json(
        { error: "unknown_trip", message: `"${user}" has no trip called "${tripId}".` },
        { status: 404 },
      );
    }
    tripTitle = trip.title;
  } else if (tripId) {
    // Refused rather than ignored. A guest is a guest of the journal — there
    // is deliberately no per-trip guest link — and silently widening what
    // somebody asked to narrow is the one answer that cannot be argued for.
    return Response.json(
      {
        error: "invalid_request",
        message:
          "A guest link is journal-wide: being let in opens every trip marked " +
          '`visibility: guest`, and never one marked `private`. There is no per-trip guest ' +
          "link. To hold one trip back from the people you have let in, mark it `private`.",
      },
      { status: 400 },
    );
  }

  // Mail it rather than hand back a link to copy — B319. The owner typing an
  // address here is the owner vouching for it: `createInvite` records it as
  // `email_key`, which is what pre-approves it — see `preapprovedEmailFor`
  // and the confirming routes. Nothing downstream treats a *missing* email
  // any differently from before; this only ever adds a capability.
  const rawEmail = typeof body.email === "string" ? body.email.trim() : "";
  if (rawEmail && !isEmail(rawEmail)) {
    return Response.json(
      { error: "invalid_email", message: `"${rawEmail}" does not look like an email address.` },
      { status: 400 },
    );
  }

  const days = typeof body.days === "number" && Number.isFinite(body.days) ? body.days : undefined;
  const locale = typeof body.locale === "string" ? body.locale : undefined;
  const created = await createInvite(user, {
    kind,
    tripId: tripId || null,
    name: typeof body.name === "string" ? body.name : undefined,
    locale,
    // Always dated. A link that never expires is the shared password again,
    // wearing a URL.
    expiresAt: inviteExpiry(days),
    email: rawEmail || null,
  });

  const invite = (await listInvites(user)).find((row) => row.id === created.id);
  if (!invite) return Response.json({ error: "not_created" }, { status: 500 });

  const url = inviteLinkUrl(serverSite().url, user, kind, created.token);

  // Best effort (B272's lesson): the invite already exists and, when an
  // address was given, is already pre-approved by the time this runs — a
  // send failure must not undo either, or fail a call that has already done
  // its job. `sendInviteMail` logs and swallows its own errors; `sent` only
  // says whether a mail actually left, for the owner's own information.
  const journal = getUser(user)!; // `guard` above already confirmed it exists.
  const sent = rawEmail
    ? (await sendInviteMail(user, journal, {
        email: rawEmail,
        // `invite.locale` is what `createInvite` actually kept — `parseLocale`
        // already dropped anything not installed here, so this reads back the
        // same fallback the link's own prefill uses rather than trusting the
        // raw request a second time.
        locale: pickLocale(invite.locale, journal.defaultLocale),
        kind,
        url,
        tripTitle,
      })) !== null
    : false;

  return Response.json(
    {
      ok: true,
      invite: view(user, invite, created.token),
      sent,
      note: rawEmail
        ? sent
          ? `Mailed to ${rawEmail}. That address is pre-approved: proving it is all that is ` +
            "left, and it will not sit in your queue."
          : mailFailedNote(rawEmail, user)
        : kind === "buddy"
          ? "Send this only to the people who were actually on the trip. Redeeming it puts " +
            "them in your queue; approving them lets them write to the trip and read the " +
            "journal's guest trips."
          : "Safe to forward. Everyone who opens it asks separately, and you approve each " +
            "one by hand.",
      next: rawEmail
        ? `${rawEmail} opens the mail, proves their address, and is in — no queue, no second click.`
        : `The person opens the link, proves their address, and appears at /${user}/contacts for you to approve.`,
    },
    { status: 201 },
  );
}
