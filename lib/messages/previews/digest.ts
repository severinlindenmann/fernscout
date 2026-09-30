import { composeDayLetter, exampleDayLetter } from "../../digest/dayLetter";
import { composeEveningNudge } from "../../digest/reminder";
import { composeFirstTripMail, composeFirstTripPush } from "../../digest/firstTrip";
import { composeDayPush } from "../../digest/dayPush";
import { composeSpendAlert } from "../../spendAlert";
import { composeOperatorAlert } from "../../operatorAlert";
import { composeDayWhatsappPreview } from "@paid/whatsapp/lib/digest/dayWhatsapp";
import { translateIn } from "../../locales";
import { SAMPLE } from "./sample";
import type { PreviewMap } from "./types";

/** A username slug for a URL, derived from the sample owner's own name —
 * never a fact stated to anybody, just what a link needs. */
const SAMPLE_USERNAME = SAMPLE.owner.toLowerCase();
const SAMPLE_URL = "https://fernscout.ch/w/k3x9";
const SAMPLE_SITE_URL = "https://fernscout.ch";

/** B2493 group B — digests, nudges, operator mail, and every SMS, share,
 * push and open-core WhatsApp text. Every entry below calls the exact
 * composer its send site calls, with `SAMPLE` (and only `SAMPLE`) standing
 * in for the real values a send would have read off disk. */
export const digestPreviews: PreviewMap = {
  // A real published day from the demo journal, so the letter carries real
  // words; the marker below only shows on an instance without one.
  "news.mail": (locale) =>
    exampleDayLetter(locale, SAMPLE.name) ??
    composeDayLetter({
      locale,
      journalTitle: SAMPLE.journal,
      dayTitle: SAMPLE.day,
      lead: "(The day's own first paragraph goes here: this instance has no demo day to show.)",
      metaParts: [translateIn(locale, "dayMail.timezone", { zone: "UTC" })],
      mapUrl: null,
      dayUrl: SAMPLE_URL,
      recipientName: SAMPLE.name,
      unsubscribeUrl: SAMPLE_URL,
    }),

  "nudge.evening": (locale) =>
    composeEveningNudge({ username: SAMPLE_USERNAME, journalTitle: SAMPLE.journal, tripTitle: SAMPLE.trip }, locale),

  "nudge.first.mail": (locale) =>
    composeFirstTripMail({ username: SAMPLE_USERNAME, journalTitle: SAMPLE.journal }, locale),
  "nudge.first.push": (locale) =>
    composeFirstTripPush({ username: SAMPLE_USERNAME, journalTitle: SAMPLE.journal }, locale),

  "op.spend": () =>
    composeSpendAlert({
      siteName: SAMPLE.site,
      amountRappen: 1234,
      date: "2026-07-04",
      lineRappen: 1000,
      siteUrl: SAMPLE_SITE_URL,
      parts: [
        { operation: "write_day", rappen: 5 },
        { operation: "describe_photos", rappen: 1229 },
      ],
    }),

  "op.alert": () =>
    composeOperatorAlert({
      unit: "fernscout-backup.service",
      succeeded: true,
      hostname: "the box",
      when: "2026-07-04 03:00 UTC",
      siteName: SAMPLE.site,
      siteUrl: SAMPLE_SITE_URL,
      report: null,
      reportWithheldNotOperator: false,
      piped: "",
    }),

  // `readers.share.text` is the owner's own share text, in the studio
  // (`components/studio/readers/ShareLink.tsx` / `InviteLinkDoor.tsx`) —
  // nothing composes it server-side to send; the studio reads the same key.
  "invite.share": (locale) => ({
    channel: "share",
    text: translateIn(locale, "readers.share.text", { trip: SAMPLE.trip, site: SAMPLE.site }),
  }),

  // The operator types this one themselves each time — there is no fixed
  // text to preview (`app/api/admin/sms/route.ts`: `body.body`, trimmed,
  // sent as-is).
  "op.sms": () => ({ channel: "sms", freeform: "Written by the operator each time — no fixed text." }),

  "news.push": (locale) => composeDayPush({ journalTitle: SAMPLE.journal, dayTitle: SAMPLE.day }, locale),

  // Outside a 24-hour service window WhatsApp only sends a pre-approved
  // Meta template by name, filling its body parameters — the approved
  // wording itself lives only at Meta (see the module comment in
  // `paid/whatsapp/lib/digest/dayWhatsapp.ts`). This shows the template
  // name and its parameters, honestly, rather than inventing prose nobody
  // approved.
  "news.wa": (locale) =>
    composeDayWhatsappPreview(
      {
        recipientName: SAMPLE.name,
        tripTitle: SAMPLE.trip,
        tripId: "balkans-2026",
        dayTitle: SAMPLE.day,
        dayDate: "2026-07-04",
        manageUrl: SAMPLE_URL,
      },
      locale,
    ),
};
