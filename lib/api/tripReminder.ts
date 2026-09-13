import "server-only";
import { isEnabled } from "../capabilities";
import { getTrip, parseTripRef, type TripRef } from "../trips";
import type { ReminderChannel } from "../types";
import { getUser } from "../users";
import { reminderTemplate } from "../whatsapp/settings";
import { REMINDER_CHANNELS } from "../tripWrite";
import { readTripFile, writeTripFile } from "./v2/store";

/**
 * Turning an evening reminder on or off for a trip that already exists —
 * B1219, D46, and D18 for the shape it has now.
 *
 * It used to be two textual splices into `trip.md`'s frontmatter —
 * `reminder: true` and `reminderChannel:` — for want of a block editor. Both
 * the file and the split are gone: the setting is one field on the trip
 * document, `reminder: {channel}`, where presence is the switch. v1 could
 * write `reminder: true` with no channel beside it, a disagreement
 * `lib/trips.ts` still carries a warning for; this shape cannot express it.
 *
 * Owner only, like `.../visibility` — a trip-scoped token can write days into
 * its trip but a reminder about the trip going quiet is the owner's own
 * question to answer, decided in the room rather than by whoever is holding
 * the pen that week. That check lives in the route, not here.
 */

export type ReminderWriteResult =
  | { ok: true; enabled: boolean; channel: ReminderChannel | null }
  | { ok: false; error: string; message?: string; bug?: true };

/** Read the setting as `getTrip` already derives it — nothing this module
 *  does not already trust. Also the read-back the writer checks itself
 *  against, which is why it reads through `getTrip` rather than the stored
 *  document: it must answer the question the *site* would answer. */
export function readTripReminder(
  ref: TripRef,
): { enabled: boolean; channel: ReminderChannel | null } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return { enabled: Boolean(trip.reminder), channel: trip.reminder?.channel ?? null };
}

export function patchTripReminder(ref: TripRef, raw: unknown): ReminderWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_request",
      message: 'Send {"enabled": true, "channel": "mail"} or {"enabled": false}.',
    };
  }
  const body = raw as { enabled?: unknown; channel?: unknown };
  if (typeof body.enabled !== "boolean") {
    return { ok: false, error: "invalid_enabled", message: "enabled must be true or false." };
  }
  const enabled = body.enabled;

  // Turning it off never needs a valid channel — there is nothing left to
  // send it on. Turning it on keeps whatever channel was already set when
  // none is named, and defaults to mail, which needs no configuration beyond
  // the journal's own mail switch.
  const requested = body.channel === undefined ? (trip.reminder?.channel ?? "mail") : body.channel;
  if (enabled && !REMINDER_CHANNELS.includes(requested as ReminderChannel)) {
    return {
      ok: false,
      error: "invalid_channel",
      message: `channel "${String(requested)}" is not one of ${REMINDER_CHANNELS.join(", ")}.`,
    };
  }
  const channel = enabled ? (requested as ReminderChannel) : null;

  // A channel that could never actually send is refused here rather than
  // written and left silently inert — the same rule that keeps this project
  // from accepting a field a caller can never see take effect.
  if (enabled && channel === "whatsapp") {
    const { username } = parseTripRef(ref) ?? {};
    const user = username ? getUser(username) : null;
    if (!user) return { ok: false, error: "unknown_trip" };
    if (!isEnabled("whatsapp", username)) {
      return {
        ok: false,
        error: "channel_unavailable",
        message: "This journal's WhatsApp channel is switched off; switch it on first, or choose mail.",
      };
    }
    if (!user.owner.tel) {
      return {
        ok: false,
        error: "channel_unavailable",
        message: "There is no phone number on file for the owner to send a WhatsApp reminder to; choose mail.",
      };
    }
    if (!reminderTemplate()) {
      return {
        ok: false,
        error: "channel_unavailable",
        message:
          "This instance has not configured an approved WhatsApp template for reminders yet " +
          "(features.whatsapp.reminderTemplate); choose mail.",
      };
    }
  }

  /**
   * The write itself — D18, B1638.
   *
   * This was two textual splices into `trip.md`'s frontmatter, and the day
   * `lib/trips.ts` stopped reading that file the splices became writes into
   * nothing: the route still answered, the helper still said **"Saved."**,
   * and the setting was gone. That is the one failure this codebase takes
   * most seriously — a true-sounding sentence about somebody's own journal —
   * so the fix is not only a new file format but the read-back below, which
   * is what makes the sentence checkable rather than hopeful.
   *
   * One field now, not two: `reminder: {channel}` present means on, absent
   * means off, so there is no second scalar that can disagree with the first.
   */
  const { username } = parseTripRef(ref) ?? {};
  if (!username) return { ok: false, error: "unknown_trip" };

  const stored = readTripFile(username, trip.id);
  if (!stored) return { ok: false, error: "unknown_trip" };

  writeTripFile(username, trip.id, {
    ...stored,
    reminder: enabled && channel ? { channel } : undefined,
  });

  const after = readTripReminder(ref);
  if (!after || after.enabled !== enabled || after.channel !== channel) {
    return {
      ok: false,
      bug: true,
      error: "trip.json was written but does not read back what was asked. This is a bug; please report it.",
    };
  }
  return { ok: true, enabled: after.enabled, channel: after.channel };
}
