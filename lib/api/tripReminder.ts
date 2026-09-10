import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isEnabled } from "../capabilities";
import { getTrip, parseTripRef, tripDir, type TripRef } from "../trips";
import type { ReminderChannel } from "../types";
import { getUser } from "../users";
import { reminderTemplate } from "../whatsapp/settings";
import { spliceScalar } from "../frontmatterScalar";

/**
 * Turning an evening reminder on or off for a trip that already exists —
 * B1219, D46.
 *
 * The same shape `lib/api/tripVisibility.ts` built: a textual splice of two
 * frontmatter scalars, validated before anything reaches disk, `matter()`-
 * parsed after so a corrupting edit writes nothing. Two lines rather than a
 * `reminder: {channel: …}` block, because `spliceScalar` only ever touches a
 * top-level scalar — see that module's own doc comment for why a block editor
 * is a second function rather than a flag on this one.
 *
 * Owner only, like `.../visibility` — a trip-scoped token can write days into
 * its trip but a reminder about the trip going quiet is the owner's own
 * question to answer, decided in the room rather than by whoever is holding
 * the pen that week. That check lives in the route, not here.
 */

export const REMINDER_CHANNELS: readonly ReminderChannel[] = ["mail", "whatsapp"];

export type ReminderWriteResult =
  | { ok: true; enabled: boolean; channel: ReminderChannel | null }
  | { ok: false; error: string; message?: string; bug?: true };

/** Read `reminder:`/`reminderChannel:` as `getTrip` already derives them —
 *  nothing this module does not already trust. */
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

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");
  let spliced: string | null = spliceScalar(text, "reminder", enabled ? "reminder: true" : null);
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }
  spliced = spliceScalar(spliced, "reminderChannel", channel ? `reminderChannel: ${channel}` : null);
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }

  try {
    matter(spliced);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave trip.md unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  fs.writeFileSync(file, spliced);

  const after = readTripReminder(ref);
  if (!after || after.enabled !== enabled || after.channel !== channel) {
    return {
      ok: false,
      bug: true,
      error: "trip.md was written but does not read back what was asked. This is a bug; please report it.",
    };
  }
  return { ok: true, enabled: after.enabled, channel: after.channel };
}
