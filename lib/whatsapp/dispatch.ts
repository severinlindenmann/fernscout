import "server-only";
import fs from "node:fs";
import path from "node:path";
import { reversePlace } from "../addressLookup";
import { createDraft, factsOfInput, type DraftInput } from "../api/entries";
import { fillDayWeatherQuietly } from "../api/weather";
import { isEmail } from "../auth";
import { isEnabled } from "../capabilities";
import { contentRoot } from "../contentRoot";
import { createInvite, inviteLinkUrl } from "../contacts/invites";
import { balanceOf } from "../credits";
import { getUser } from "../users";
import { currentHelperProvider, hasHelperConsent, recordHelperConsent } from "../helper/consent";
import { NO_PROSE } from "../helper/draft";
import type { Say } from "../helper/intents";
import { answerInThread } from "../helper/model";
import { recordTurn } from "../helper/sessions";
import { MAX_AUDIO_BYTES, MAX_SPEECH_SECONDS, speechLanguageFor } from "../helper/speech";
import { history, proposed, remember, sessionId, wrote } from "../helper/thread";
import { spendAndTranscribe } from "../helper/transcribeSpend";
import { kindForExtension, listInbox, storeInboxFile } from "../inbox";
import { translateIn } from "../locales";
import { claimPhoneLink } from "../phoneVerify/inboundLink";
import { journalForNumber } from "../registry";
import { serverSite } from "../site";
import { storageRefusal } from "../storageQuota";
import { missingFrom, UNKNOWN } from "../tracks";
import { getTrips, tripRef } from "../trips";
import type { Trip } from "../types";
import { isAcknowledgement } from "./acknowledge";
import { hasAcknowledged, hasBeenGreeted, markAcknowledged, markGreeted } from "./binding";
import { downloadMedia } from "./cloud";
import { announceHeldAnswer, takeHeldAnswer } from "./held";
import { cloudCredentials, maskNumber } from "./index";
import { holdProposal, takePendingProposal } from "./pendingProposal";
import { isWhatsappExecutable, pressProposal } from "./proposalExecution";
import { CONFIRM_NO_ID, CONFIRM_YES_ID, confirmButtonsFor, renderForWhatsapp } from "./render";
import { balanceRefusal } from "./refusal";
import { sendOutboundReply, sendServiceReply } from "./reply";
import { clearPendingSpeechAsk, hasPendingSpeechAsk, markPendingSpeechAsk } from "./speechConsent";
import { contactFor, isStopWord, stopReplyFor } from "./stop";
import { hasBeenTold, markTold } from "./toldOnce";
import { markInbound } from "./window";
import type { InboundMessage } from "./inbound";

/** WhatsApp gives an image or a sticker no filename at all, only a mime type
 *  — this is the whole of the mapping `lib/inbox.ts:kindForExtension` needs
 *  to route it correctly. A type this does not recognise falls back to
 *  `.bin`, which `kindForExtension` reads as "files" rather than "media" —
 *  the safe direction, since a photograph misfiled as a document is still
 *  found in the inbox and a document misfiled as a photograph is not. */
const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/**
 * What happens to a normalised inbound message, once it has been verified,
 * deduplicated and rate-limited by the webhook route — B1058.
 *
 * **Binding is automatic and owner-only.** The sender's E.164 is compared
 * against B1064's registry — the same lock that stops two journals claiming
 * one proven number — and a match *is* the journal, with no confirmation tap
 * and no linking code. That is the whole of "who is this for": nothing here
 * asks a buddy or a guest to prove a number, because the helper this channel
 * reaches is owner-only today (B1055).
 *
 * **A stranger gets one fixed sentence and a link, and costs no model call.**
 * Not "the model declines" — the model is never reached. Same for the first
 * message of a new binding: three disclosures (it's an AI, which journal,
 * the consent notice) assembled from `site/locales/*.json` in the journal's
 * own configured locale, in code, never generated. AGENTS.md's own finding
 * about the honesty guards applies here one level down: a sentence with
 * legal weight (B1063, B1077) has to read identically every time, which a
 * model composing it fresh cannot promise.
 *
 * **Not built here: any reply to an already-greeted number.** That is a
 * model turn (B1056/B1061), genuinely out of scope for this ticket — the
 * queue, debounce and typing-indicator machinery B1057's ticket describes
 * exist to serve *that* reply and have nothing to attach to yet.
 */
export async function handleInboundMessage(message: InboundMessage): Promise<void> {
  /**
   * A signup phone-proof token — B1234 — before anything else, because the
   * sender is by definition a number this instance has never seen: letting
   * it fall through would hand them the stranger sentence instead of the
   * confirmation they were promised. `claimPhoneLink` answers null for a
   * message with no token in it, which is every ordinary message.
   */
  if (message.kind === "text") {
    const claim = await claimPhoneLink(message.body, message.from);
    if (claim) {
      // No markInbound: there is no journal yet, and a username-less reply
      // is always inside the window of the message it answers (reply.ts).
      await sendServiceReply(
        message.from,
        translateIn(
          claim.locale as Parameters<typeof translateIn>[0],
          claim.outcome === "confirmed" ? "wa.phoneLinkConfirmed" : "wa.phoneLinkExpired",
        ),
        null,
      );
      return;
    }
  }

  const username = journalForNumber(message.from);

  if (!username) {
    /**
     * "STOP" from a reader — B1062, superseding B386. Not the owner (this
     * number would already be bound if it were), so the only person this
     * could be is a guest or a reader of *somebody's* journal. Gated on
     * `whatsappInbound` for the journal the number belongs to, same as every
     * other reply on this channel — otherwise treated as an ordinary
     * stranger. A buddy is unreachable by this scan (buddies are not in
     * `listContacts`, which is the guest/reader table) and falls through to
     * the ordinary stranger sentence below, which is the owner's own
     * "ignore it" for anyone this number could plausibly be other than a
     * reader.
     */
    if (message.kind === "text" && isStopWord(message.body)) {
      const found = await contactFor(message.from);
      if (found && isEnabled("whatsappInbound", found.username)) {
        const url = stopReplyFor(found.username, found.contactId);
        await sendServiceReply(message.from, translateIn(found.locale, "wa.stopReply", { url }), null);
        console.log(`[whatsapp:inbound] STOP from ${maskNumber(message.from)}, matched to ${found.username}'s contacts`);
        return;
      }
    }

    const site = serverSite();
    // No journal to pick a locale from — a stranger's number binds to
    // nothing, and there is no `Accept-Language` on a webhook delivery.
    // English, the same fallback `translateIn` itself uses when a locale has
    // no dictionary at all.
    const reply = translateIn("en", "wa.strangerReply", { site: site.name, url: site.url });
    await sendServiceReply(message.from, reply, null);
    console.log(`[whatsapp:inbound] stranger ${maskNumber(message.from)} refused with no model call`);
    return;
  }

  // The webhook route already checked the *server* can read WhatsApp at
  // all (`isEnabled("whatsappInbound")`, no username — that question is
  // asked before any binding is known). This is the other half: whether
  // *this journal* has opted into the conversational channel, which is a
  // different question from `whatsapp` (day announcements) — the two
  // capabilities exist separately for exactly this reason, and checking the
  // wrong one here would silently ignore a journal's own "no".
  if (!isEnabled("whatsappInbound", username)) {
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} matches ${username}, which has not opted into the channel — no reply`);
    return;
  }

  /**
   * Opens (or extends) this number's 24-hour window — B1061 — **before**
   * anything below is sent, so every reply this message provokes, including
   * the one three lines down, finds a window it just proved open.
   */
  markInbound(username, message.from);

  const user = getUser(username);
  const locale = user?.defaultLocale ?? "en";

  /**
   * Whatever was ready before this number wrote again — B1061. "Never
   * initiate" means a late answer cannot be pushed; it waits for exactly
   * this moment, and is delivered before anything this message itself
   * provokes, so nobody reads their own new reply as an answer to something
   * they have not yet said.
   */
  const held = takeHeldAnswer(username, message.from);
  if (held) {
    await sendOutboundReply(message.from, announceHeldAnswer(locale, held), username);
    console.log(`[whatsapp:inbound] delivered a held answer to ${maskNumber(message.from)} (${username}), held since ${held.heldAt}`);
  }

  if (!hasBeenGreeted(username, message.from)) {
    const journalUrl = `${serverSite().url}/${username}`;
    // The room at /agent?c=<id> adopts this same conversation (B1168/B1054),
    // so the greeting can honestly promise the web as a second door — the
    // session row this creates is the one every later turn lands in.
    const agentUrl = `${serverSite().url}/agent?c=${await sessionId(username, "whatsapp")}`;
    const reply = translateIn(locale, "wa.firstReply", { journalUrl, agentUrl });
    await sendServiceReply(message.from, reply, username);
    markGreeted(username, message.from);
    console.log(`[whatsapp:inbound] greeted a newly bound number for ${username}`);
    return;
  }

  /**
   * The disclosure the first reply carried has not been agreed to yet —
   * B1138. Nothing past this point runs, model turn included (B1056 checks
   * this same state before it ever calls one) — a "yes" is the only thing
   * this number's messages are read for until one arrives.
   */
  if (!hasAcknowledged(username, message.from)) {
    if (message.kind === "text" && isAcknowledgement(message.body, locale)) {
      markAcknowledged(username, message.from);
      // The disclosure this reply is agreeing to *is* the "your words go to
      // a model" consent the web room's own panel asks for — B684's scope,
      // agreed to by a different door. Recording it here is what lets an
      // owner who has never opened `/agent` still pass `hasHelperConsent`
      // once the model turn below is reached.
      recordHelperConsent(username, currentHelperProvider("words"), "words");
      await sendServiceReply(message.from, translateIn(locale, "wa.acknowledged"), username);
      console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) acknowledged`);
      return;
    }
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) not yet acknowledged — no model call`);
    return;
  }

  if (message.kind === "audio") {
    await handleVoiceNote(username, locale, message);
    return;
  }

  if (message.kind === "image" || message.kind === "document") {
    await handleMedia(username, locale, message);
    return;
  }

  if (message.kind === "location") {
    await handleLocationPin(username, locale, message);
    return;
  }

  if (message.kind === "contacts") {
    await handleContactCard(username, locale, message);
    return;
  }

  if (message.kind === "video" || message.kind === "sticker") {
    // Not doing video in this release — decided on B1059. A sticker is the
    // same "not a photograph, not a document" shape and gets the same
    // sentence, told once per number, same as the tip below.
    if (!hasBeenTold(username, message.from, "video")) {
      await sendServiceReply(message.from, translateIn(locale, "wa.videoNotSupported"), username);
      markTold(username, message.from, "video");
    }
    return;
  }

  /**
   * The answer to a `speech` consent ask, read before an ordinary turn would
   * be — B1060. Cleared either way: a "yes" grants the scope, anything else
   * is read as having moved on rather than as a standing refusal, so a later
   * voice note asks again rather than being silently ignored forever.
   */
  if (message.kind === "text" && hasPendingSpeechAsk(username, message.from)) {
    clearPendingSpeechAsk(username, message.from);
    if (isAcknowledgement(message.body, locale)) {
      recordHelperConsent(username, currentHelperProvider("speech"), "speech");
      await sendServiceReply(message.from, translateIn(locale, "wa.speechConsentGranted"), username);
      console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) granted speech consent`);
      return;
    }
    // Not a "yes" — an ordinary sentence, answered ordinarily below.
  }

  /**
   * A tap on the two buttons a waiting proposal offers — B1230, and read
   * before the ordinary "say the button's label back" rule below, which is
   * what every *other* button (a `choose`, a day-gap pick) still follows.
   * `CONFIRM_YES_ID`/`CONFIRM_NO_ID` are the two fixed ids `render.ts`'s
   * `confirmButtonsFor` always uses, never a locale-dependent title, so this
   * matches regardless of what language the button was drawn in.
   */
  if (message.kind === "interactive" && (message.replyId === CONFIRM_YES_ID || message.replyId === CONFIRM_NO_ID)) {
    await handleProposalReply(username, locale, message.from, message.replyId === CONFIRM_YES_ID);
    return;
  }

  const said =
    message.kind === "text"
      ? message.body.trim()
      : message.kind === "interactive"
        ? message.title.trim()
        : "";
  if (said === "") {
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — ${message.kind} (${message.id}), no model turn for this kind yet`);
    return;
  }
  await answerOnWhatsapp(username, locale, message.from, said);
}

/**
 * One voice note, over WhatsApp — B1060.
 *
 * Consent first, and specific to `speech` — B684/B687's split, and B1138's
 * acknowledgement is a different scope (`words`) that does not cover this.
 * Then the money path: `spendAndTranscribe` is the exact four steps
 * `app/api/helper/[user]/transcribe/route.ts` already takes (spend, call,
 * refund on failure, reconcile to what Deepgram actually measured), shared
 * rather than copied — B1060's own "Gap found" addendum is why that sharing
 * is the point of this function and not an incidental tidiness.
 *
 * **Idempotency is already settled before this runs.** Meta retries a
 * webhook for up to seven days, and `app/api/webhooks/whatsapp/route.ts`
 * dedupes on the wamid *before* `handleInboundMessage` is ever called — so a
 * retried voice note never reaches this function a second time, and never
 * reaches Deepgram or the ledger twice for one recording.
 *
 * The transcript is echoed back **before** it becomes a `said` fed to the
 * model — B1060's own instruction: a misheard place name that becomes a day
 * is worse than one extra message.
 */
async function handleVoiceNote(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "audio" }>,
): Promise<void> {
  if (!isEnabled("helper", username) || !isEnabled("transcription", username)) {
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — transcription is not enabled here`);
    return;
  }

  if (!hasHelperConsent(username, "speech")) {
    markPendingSpeechAsk(username, message.from);
    await sendServiceReply(message.from, translateIn(locale, "wa.speechConsentAsk"), username);
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) asked for speech consent`);
    return;
  }

  const language = speechLanguageFor(null, locale);
  if (!language) {
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — no supported transcription language for locale "${locale}"`);
    return;
  }

  let audio: { data: Buffer; mimeType: string };
  try {
    audio = await downloadMedia(cloudCredentials(), message.mediaId);
  } catch (err) {
    console.error(`[whatsapp:inbound] could not download voice note for ${username}:`, err);
    return;
  }

  if (audio.data.byteLength > MAX_AUDIO_BYTES) {
    await sendServiceReply(
      message.from,
      translateIn(locale, "wa.voiceTooLong", { maxMinutes: String(Math.floor(MAX_SPEECH_SECONDS / 60)) }),
      username,
    );
    return;
  }

  const mediaType = (audio.mimeType || message.mimeType).split(";")[0].toLowerCase();
  // WhatsApp's webhook carries no duration, so nothing is claimed up front —
  // `spendAndTranscribe` prices that as its one-hundredth-credit floor and
  // reconciles to Deepgram's own measured seconds afterwards, exactly as a
  // web recording with the microphone's own estimate does when it under-
  // reports.
  const outcome = await spendAndTranscribe(username, audio.data, mediaType, language, 0);
  if (!outcome.ok) {
    if (outcome.error === "no_credits") {
      const balance = (await balanceOf(username)) ?? 0;
      await sendServiceReply(message.from, balanceRefusal(locale, username, outcome.cost, balance), username);
    } else {
      console.error(`[whatsapp:inbound] transcription failed for ${username}`);
    }
    return;
  }

  await sendServiceReply(message.from, translateIn(locale, "wa.transcriptEcho", { text: outcome.text }), username);
  await answerOnWhatsapp(username, locale, message.from, outcome.text);
}

/**
 * One photograph or document, over WhatsApp — B1059.
 *
 * **Stored as it arrives, with where it came from.** `lib/inbox.ts`'s
 * `InboxMeta` gained `source`/`receivedAt` for exactly this: a photograph
 * sent *as a photograph* has already had its EXIF stripped by WhatsApp
 * (compressed, no capture time, no coordinates), so `receivedAt` — when the
 * message arrived — is the one honest timestamp there is to keep. The same
 * file sent *as a document* arrives byte-for-byte intact; this does not
 * re-read its EXIF (a documented scope cut, not an oversight — see the
 * ticket), but it does land at full resolution rather than WhatsApp's
 * roughly-1600px re-encode, which is most of the reason the document route
 * exists at all.
 *
 * **The storage ceiling is checked before a byte is written**, the same
 * `storageRefusal` the web upload doors use, so this channel cannot be the
 * way round a journal's own limit.
 *
 * **The documents-versus-photos tip is said once**, on whichever of the two
 * a person happens to send first, and never again.
 */
/** `sha256` is the field this variant of `InboundMessage` has that no other
 *  does (audio's shares `mediaId`/`mimeType` but never a hash), so it is
 *  what actually narrows `Extract` here — matching on `kind` does not, since
 *  `InboundMessage` types "image" | "video" | "document" | "sticker" as one
 *  member with a unioned `kind` field rather than as four separate ones. */
type MediaMessage = Extract<InboundMessage, { sha256: string }>;

async function handleMedia(username: string, locale: string, message: MediaMessage): Promise<void> {
  let downloaded: { data: Buffer; mimeType: string };
  try {
    downloaded = await downloadMedia(cloudCredentials(), message.mediaId);
  } catch (err) {
    console.error(`[whatsapp:inbound] could not download ${message.kind} for ${username}:`, err);
    return;
  }

  const refusal = await storageRefusal(username, downloaded.data.byteLength);
  if (refusal) {
    await sendServiceReply(message.from, refusal, username);
    return;
  }

  const mimeType = (downloaded.mimeType || message.mimeType).split(";")[0].toLowerCase();
  // A photograph sent *as a photograph* carries no filename at all — and
  // deliberately not one built from `message.mediaId` either: `storeInboxFile`
  // hashes the filename stem alongside the bytes, so an id built from a
  // per-send media id would make the same photograph, sent twice, two files
  // rather than one. A fixed generic name keeps the id a function of the
  // bytes, which is the whole of the "sent twice" acceptance line.
  const filename =
    message.kind === "document" && message.filename
      ? message.filename
      : `whatsapp-photo${MIME_EXTENSION[mimeType] ?? ".bin"}`;
  const kind = kindForExtension(filename) ?? "files";

  const stored = storeInboxFile(username, kind, filename, downloaded.data, {
    ...(message.caption ? { caption: message.caption } : {}),
    source: "whatsapp",
    receivedAt: new Date(Number(message.timestamp) * 1000 || Date.now()).toISOString(),
  });

  const topic = message.kind === "document" ? "document" : "photo";
  const alreadyToldEitherWay = hasBeenTold(username, message.from, "photo") || hasBeenTold(username, message.from, "document");
  const total = Object.values(listInbox(username))
    .flat()
    .filter((entry) => entry.kind === "media" || entry.kind === "files").length;
  const landed = translateIn(locale, "wa.mediaLanded", { count: String(total) });
  const body = alreadyToldEitherWay ? landed : `${landed}${translateIn(locale, "wa.mediaTip")}`;
  if (!alreadyToldEitherWay) markTold(username, message.from, topic);

  await sendServiceReply(message.from, body, username);
  console.log(
    `[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — ${message.kind} landed in the inbox as ${stored.entry.id}`,
  );
}

/**
 * Which trip a date belongs to, when it might belong to several — B1074.
 *
 * **Never guessed past the tiebreak the owner chose.** No trip covering the
 * date is a refusal; exactly one is used outright; more than one uses the
 * most recently *created* — read from `trip.md`'s own file time, since
 * nothing in `Trip` carries a creation timestamp — which is a real rule
 * rather than "ask again", so ambiguity resolves the same way every time
 * rather than depending on which trip happened to sort first.
 */
function tripForDate(username: string, date: string): Trip | null {
  const covering = getTrips(username).filter((trip) => date >= trip.start && date <= trip.end);
  if (covering.length === 0) return null;
  if (covering.length === 1) return covering[0];
  const withCreated = covering.map((trip) => {
    let created = 0;
    try {
      created = fs.statSync(path.join(contentRoot(), username, "trips", trip.id, "trip.md")).mtimeMs;
    } catch {
      // No file to stat is not reachable in practice (a listed trip has one)
      // — 0 just sorts it last rather than throwing on the pin somebody sent.
    }
    return { trip, created };
  });
  withCreated.sort((a, b) => b.created - a.created);
  return withCreated[0].trip;
}

/**
 * A location pin — B1074.
 *
 * The date is the message's own arrival date: WhatsApp carries no other date
 * on a pin, and the sender is describing where they are *now*, not annotating
 * a day they already wrote. `createDraft` is the exact function
 * `app/api/helper/[user]/day/route.ts` calls — the same write, reached
 * directly rather than through that cookie-gated route, the way every tool
 * in `lib/helper/tools/` already reaches it.
 */
async function handleLocationPin(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "location" }>,
): Promise<void> {
  const date = new Date((Number(message.timestamp) || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
  const trip = tripForDate(username, date);
  if (!trip) {
    await sendServiceReply(message.from, translateIn(locale, "wa.locationNoTrip", { date }), username);
    return;
  }

  const ref = tripRef(username, trip.id);
  const place = isEnabled("addressLookup", username)
    ? await reversePlace(message.latitude, message.longitude, locale)
    : null;

  const input: DraftInput = {
    title: date,
    date,
    content: NO_PROSE,
    lat: message.latitude,
    lng: message.longitude,
    ...(place ? { location: place.location, country: place.country } : {}),
    ...(place?.countryCode ? { countryCode: place.countryCode } : {}),
    weather: true,
    // A pin carries no cost figures and nobody has been asked for any yet —
    // "unknown" rather than "none", the same honest third answer
    // `components/AgentWizard.tsx` gives for whatever a day is created with
    // no answer to. `coordinates` needs no such marker: it is the one track
    // this write actually satisfies.
    costs: UNKNOWN,
  };

  const missing = missingFrom(factsOfInput(input), trip.tracks, "write");
  if (missing.length > 0) {
    await sendServiceReply(message.from, translateIn(locale, "wa.locationIncomplete", { title: trip.title }), username);
    return;
  }

  const written = createDraft(ref, input);
  if (!written.ok) {
    await sendServiceReply(message.from, translateIn(locale, "wa.locationIncomplete", { title: trip.title }), username);
    return;
  }
  await fillDayWeatherQuietly(ref, written.slug);
  wrote(username, "start_day", { trip: trip.id, slug: written.slug, date }, "whatsapp");

  await sendServiceReply(
    message.from,
    translateIn(locale, "wa.locationPinCreated", { date, title: trip.title }),
    username,
  );
}

/**
 * A shared contact card — B1074, option A.
 *
 * **Reuses `createInvite` unchanged.** No new storage, no new page: the
 * reply itself is the invitation waiting to be sent, and the owner forwards
 * it — from here, or however they would actually reach this person. Double
 * opt-in stays intact because nothing here grants anything; opening the link
 * still lands the recipient in the owner's own approval queue, exactly as a
 * guest link issued from `/‹user›/contacts` does.
 *
 * **Guest, never buddy** — a card carries no trip context, and a buddy link
 * needs one. **An email is required and never guessed**: WhatsApp's contact
 * cards usually carry a phone and sometimes an email; without one this stops
 * rather than half-creating a row with no way to reach the person about it.
 */
async function handleContactCard(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "contacts" }>,
): Promise<void> {
  for (const contact of message.contacts) {
    const email = (contact.emails ?? []).find((one) => isEmail(one.trim()))?.trim();
    if (!email) {
      await sendServiceReply(
        message.from,
        translateIn(locale, "wa.contactNeedsEmail", { name: contact.name ?? "" }),
        username,
      );
      continue;
    }
    const created = await createInvite(username, {
      kind: "guest",
      name: contact.name,
      locale,
      email,
    });
    const url = inviteLinkUrl(serverSite().url, username, "guest", created.token);
    await sendServiceReply(
      message.from,
      translateIn(locale, "wa.contactInviteMade", { name: contact.name ?? "", url }),
      username,
    );
  }
}

/**
 * The model turn, over WhatsApp — B1056.
 *
 * **The same `answerInThread` the web room calls**, with the same thread
 * (`lib/helper/thread.ts`, durable since B1054) — a person who writes on
 * WhatsApp and then opens `/agent` finds the same conversation, origin marks
 * and all. Nothing here is a second implementation of the model turn; only
 * `lib/whatsapp/render.ts` (the answer's shape) and this function (how the
 * reply goes out) are new.
 *
 * `said` is already resolved by the caller — the message body, an
 * interactive reply's title (`lib/helper/blocks.ts`'s own "pressing one says
 * its label" rule for a `choose`), or a voice note's transcript, echoed back
 * first (B1060). A photograph and a document land in the inbox instead
 * (`handleMedia`, B1059) and never reach this function; a location pin and a
 * shared contact card are B1074's. **A tap on a proposal's own accept or
 * decline button never reaches here at all** — `handleInboundMessage` reads
 * `CONFIRM_YES_ID`/`CONFIRM_NO_ID` before it ever computes `said`, and hands
 * those to `handleProposalReply` below instead (B1230).
 *
 * If this turn leaves a proposal waiting, it is held for that tap —
 * `holdProposal` — and, when the turn's own blocks did not already draw a
 * `confirm`'s buttons (a `form`-shaped proposal has no WhatsApp shape of its
 * own otherwise), a real accept/decline pair is added on top, for exactly
 * the tools `lib/whatsapp/proposalExecution.ts` knows how to press. A
 * proposal that channel will not press keeps its pre-B1230 shape — text and
 * a link into `/agent` — because a button that could not do anything is
 * worse than no button.
 */
async function answerOnWhatsapp(username: string, locale: string, to: string, said: string): Promise<void> {
  // The same capability the web room's own routes gate on — an instance
  // running with no model at all must not try to run one here either.
  if (!isEnabled("helper", username)) {
    console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) — helper is not enabled here`);
    return;
  }

  const say: Say = (key, vars) => translateIn(locale, key as Parameters<typeof translateIn>[1], vars);
  const today = new Date().toISOString().slice(0, 10);

  let thread;
  try {
    thread = await answerInThread(username, said, await history(username), today, say, [], locale);
  } catch (err) {
    console.error(`[whatsapp:inbound] model turn failed for ${username}:`, err);
    return;
  }
  if (thread.answer === "" && thread.blocks.length === 0) return;

  remember(username, said, thread.answer, "whatsapp");
  void recordTurn({
    owner: username,
    session: await sessionId(username, "whatsapp"),
    locale,
    tools: thread.looked,
    proposed: thread.proposals.map((proposal) => proposal.tool),
    guard: thread.guard,
    recovered: thread.recovered,
    threadTurns: (await history(username)).length,
    said,
    answered: thread.answer,
    origin: "whatsapp",
  });
  for (const proposal of thread.proposals) proposed(username, proposal.tool, proposal.arguments, "whatsapp");

  const blocks = [...thread.blocks, ...(thread.answer === "" ? [] : [{ shape: "say" as const, text: thread.answer }])];
  const journalUrl = `${serverSite().url}/agent`;
  let outbound = renderForWhatsapp(blocks, journalUrl);

  // At most one write proposal reaches a WhatsApp screen at a time in
  // practice — the model calls one write tool a turn — so the first is the
  // one a tap can be about; see the module doc above `holdProposal`.
  const proposal = thread.proposals[0];
  if (proposal) {
    if (outbound.kind === "buttons") {
      // A `confirm` block already drew these buttons (B1056) — hold the
      // proposal so a tap on them can find it. Whether the tap goes on to
      // execute or is told this lives on the web is `handleProposalReply`'s
      // question, not this one's.
      holdProposal(username, to, proposal);
    } else if (isWhatsappExecutable(proposal.tool)) {
      // A `form`-shaped proposal (B1230's own case: `create_trip` is exactly
      // this) had no WhatsApp shape before this ticket. It gets one now,
      // built over whatever text `renderForWhatsapp` already produced.
      outbound = confirmButtonsFor(outbound.body, proposal.accept);
      holdProposal(username, to, proposal);
    }
    // A `form`-shaped proposal for a tool this channel will never press
    // (a postcard, a photobook) keeps its pre-B1230 text-and-link shape —
    // no button is offered for a press that could not do anything.
  }

  await sendOutboundReply(to, outbound, username);
}

/**
 * A tap on a waiting proposal's own accept or decline button — B1230.
 *
 * **Take-once, always.** `takePendingProposal` both answers "is anything
 * waiting" and clears it in the same read, which is the whole of why a
 * second tap — a genuine double-press, or Meta redelivering the interactive
 * reply under a wamid its own webhook dedupe has never seen — cannot run a
 * write twice: the second call finds nothing and says so, honestly, rather
 * than repeating whatever the first one did.
 *
 * **Decline writes nothing and needs no route at all** — the proposal is
 * simply discarded, the same "leave it" the web panel's own second button
 * does with nothing to post.
 *
 * **Accept presses the same route the web panel's button would**, through
 * `pressProposal`, which itself refuses a tool this channel does not run
 * (`"web_only"`, B1230's decision 4 — a postcard, a photobook, buying
 * credits). Every other outcome is what the route itself decided, and the
 * one sentence sent back is either `proposal.done` — the exact words the web
 * panel shows after the identical press, so this can never claim more than
 * the write actually did — or a plain, honest "that could not be saved".
 */
async function handleProposalReply(username: string, locale: string, to: string, accepted: boolean): Promise<void> {
  const pending = takePendingProposal(username, to);
  if (!pending) {
    await sendOutboundReply(to, { kind: "text", body: translateIn(locale, "wa.proposalGone") }, username);
    return;
  }
  if (!accepted) {
    await sendOutboundReply(to, { kind: "text", body: translateIn(locale, "wa.proposalDeclined") }, username);
    return;
  }

  const result = await pressProposal(username, pending);
  if (result.ok) {
    await sendOutboundReply(to, { kind: "text", body: pending.done }, username);
    console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) pressed ${pending.tool} from WhatsApp`);
    return;
  }
  const key = result.error === "web_only" ? "wa.proposalWebOnly" : "wa.proposalFailed";
  await sendOutboundReply(to, { kind: "text", body: translateIn(locale, key, { error: result.error }) }, username);
  console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) press of ${pending.tool} refused: ${result.error}`);
}
