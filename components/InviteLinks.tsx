"use client";

import { useState } from "react";
import CopyLine from "./CopyLine";
import { useI18n } from "./LocaleProvider";

/**
 * The two links an owner hands to a *person* — B79, the front half of B33.
 *
 * The owner panel already hands over the two lines an agent needs
 * (`AgentHandover`). This is the same act for everybody who is not an agent:
 * the panel's job is to give you the string you are going to paste into a
 * message, and until now the only way to let a person in was a trip password
 * that could not be revoked for one of them, or opening `trip.md` in an editor
 * — neither of which is something you can do standing next to the sister who
 * just asked.
 *
 * ## Why it is two blocks and not one control with a dropdown
 *
 * A guest link and a buddy link are not two settings of one thing. One leads
 * to reading; the other leads to **writing to a trip**. Put them behind the
 * same button and the difference becomes a word in a `<select>`, which is
 * exactly where a person stops reading. So: two headings, two sentences, two
 * buttons — and the sentences say what happens in words, not in a tooltip,
 * because the reader this panel is written for is the one least comfortable
 * with software (see the docblock in `app/[user]/me/MePageContent.tsx`).
 *
 * ## What the copy may claim
 *
 * Not that the link lets anybody in, because it does not. Redeeming one writes
 * a `pending` contact and nothing else; `approveContact` is still the only
 * thing in the codebase that creates a grant. An owner who believes a
 * forwarded guest link granted access hands it out differently from one who
 * knows it did not, so the panel says the true thing first, above both blocks.
 *
 * ## Shown once, and said so
 *
 * `POST /api/v1/{user}/invites` returns the token exactly once and stores only
 * its hash, so a link that scrolls away is gone. The line above every fresh
 * link says that before the person closes the panel expecting to find it
 * again — the contacts admin prints a fresh link with no such warning and no
 * copy button, which is the shape of the problem this is not repeating.
 *
 * There is no list of live links here, and that is deliberate: see B79's task
 * file. Revoking lives one tap below, on the guest list.
 */
export default function InviteLinks({
  username,
  /** The journal's trips, from `viewer.trips` — the list already rendered
   * above under "What you can read". A second fetch would be a second answer
   * to a question the page has already asked. */
  trips,
}: {
  username: string;
  trips: { id: string; title: string }[];
}) {
  const { t, tn } = useI18n();

  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [busy, setBusy] = useState<"guest" | "buddy" | null>(null);
  const [failed, setFailed] = useState(false);
  /** The one link most recently made, and what it opens. Kept as one slot
   * rather than two: two links on screen at once, both shown once and both
   * looking like a token, is how the wrong one gets pasted. */
  const [made, setMade] = useState<{
    kind: "guest" | "buddy";
    url: string;
    trip: string | null;
    days: number;
  } | null>(null);

  async function create(kind: "guest" | "buddy") {
    setBusy(kind);
    setFailed(false);
    try {
      const response = await fetch(`/api/v1/${username}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "buddy" ? { kind, trip: tripId } : { kind }),
      });
      const body = (await response.json()) as { invite?: { url?: string; expiresAt?: string } };
      const url = body.invite?.url;
      if (!response.ok || !url) {
        setFailed(true);
        setMade(null);
        return;
      }
      setMade({
        kind,
        url,
        trip: kind === "buddy" ? (trips.find((x) => x.id === tripId)?.title ?? tripId) : null,
        days: daysUntil(body.invite?.expiresAt),
      });
    } catch {
      setFailed(true);
      setMade(null);
    } finally {
      setBusy(null);
    }
  }

  const button =
    "mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-full bg-navy-900 px-5 " +
    "text-base font-semibold text-cream-50 transition-colors hover:bg-navy-700 " +
    "disabled:opacity-60 sm:w-auto";

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-navy-900">{t("me.inviteTitle")}</h3>
      <p className="mt-1 text-base leading-7 text-navy-700">{t("me.inviteBody")}</p>

      <div className="mt-4">
        <h4 className="text-base font-semibold text-navy-900">{t("me.inviteGuestTitle")}</h4>
        <p className="mt-1 text-base leading-7 text-navy-700">{t("me.inviteGuestBody")}</p>
        <button
          type="button"
          className={button}
          disabled={busy !== null}
          onClick={() => create("guest")}
        >
          {busy === "guest" ? t("me.inviteWorking") : t("me.inviteGuestCreate")}
        </button>
      </div>

      {/* No trips, no buddy link: the API answers 404 for a trip that does not
          exist, and a select with nothing in it is a control that cannot work
          — the bug this panel already records against itself. */}
      {trips.length > 0 && (
        <div className="mt-6">
          <h4 className="text-base font-semibold text-navy-900">{t("me.inviteBuddyTitle")}</h4>
          {/* The strong claim, given the weight the token warning above gets
              for the same reason: this one leads to writing. */}
          <p className="mt-1 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
            {t("me.inviteBuddyBody")}
          </p>
          <label htmlFor="invite-trip" className="mt-3 block text-base font-medium text-navy-700">
            {t("me.inviteBuddyTrip")}
          </label>
          <select
            id="invite-trip"
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-navy-200 bg-white px-3 text-base text-navy-900"
          >
            {trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={button}
            disabled={busy !== null || !tripId}
            onClick={() => create("buddy")}
          >
            {busy === "buddy" ? t("me.inviteWorking") : t("me.inviteBuddyCreate")}
          </button>
        </div>
      )}

      {failed && <p className="mt-4 text-base leading-7 text-coral-600">{t("me.inviteFailed")}</p>}

      {made && (
        <div className="mt-5 rounded-xl border border-navy-200 bg-white p-4">
          <p className="text-base font-semibold text-navy-900">
            {made.kind === "buddy"
              ? t("me.inviteBuddyReady", { trip: made.trip ?? "" })
              : t("me.inviteGuestReady")}
          </p>
          <p className="mt-1 text-base leading-7 text-coral-600">
            {t("me.inviteOnce")}
            {made.days > 0 && ` ${tn("me.inviteExpires", made.days, { days: String(made.days) })}`}
          </p>
          {/* On screen as well as on the clipboard: `CopyLine` swallows a
              refused clipboard on purpose, and the address being selectable is
              what makes that the right call. */}
          <p className="mt-2 break-all font-mono text-sm text-navy-900">{made.url}</p>
          <div className="mt-3">
            <CopyLine
              value={made.url}
              label={t("landing.copy")}
              copiedLabel={t("landing.copied")}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Whole days from now until `expiresAt`, rounded up, so "in 30 days" is what
 * a link made this afternoon actually gets. Every link this panel issues takes
 * the API's default, but the number is read back from the answer rather than
 * hardcoded here — `INVITE_TTL_DAYS` lives in a `server-only` module and a
 * second copy of it would be a second copy to go stale. */
function daysUntil(expiresAt: string | undefined): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(1, Math.ceil(ms / 86_400_000)) : 0;
}
