import "server-only";
import { factsOfEntry } from "../api/entries";
import { isEmail } from "../auth";
import { isEnabled } from "../capabilities";
import { createInvite, inviteLinkUrl } from "../contacts/invites";
import { balanceOf, refund, spend } from "../credits";
import { getUser } from "../users";
import { AS_AUTHOR, getAllEntries } from "../entries";
import { setJournalFeatures } from "../journals";
import { currentHelperProvider, hasHelperConsent, recordHelperConsent } from "../helper/consent";
import { HELPER_TURN_CREDITS, noCreditsAnswer } from "../helper/creditGate";
import type { Proposal } from "../helper/blocks";
import { sayIn } from "../helper/intents";
import { answerInThread, WRITE_DAY_CREDITS } from "../helper/model";
import { recordTurn } from "../helper/sessions";
import { MAX_AUDIO_BYTES, MAX_SPEECH_SECONDS, speechLanguageFor } from "../helper/speech";
import { forget, history, lastTouched, proposed, remember, sessionId } from "../helper/thread";
import { spendAndTranscribe } from "../helper/transcribeSpend";
import { kindForExtension, storeInboxFile } from "../inbox";
import { translateIn } from "../locales";
import { claimPhoneLink } from "../phoneVerify/inboundLink";
import { journalForNumber } from "../registry";
import { serverSite } from "../site";
import { withStorageQuota } from "../storageQuota";
import { tripRef } from "../trips";
import { isAcknowledgement, isNewChatCommand } from "./acknowledge";
import { hasAcknowledged, hasBeenGreeted, markAcknowledged, markGreeted } from "./binding";
import { downloadMedia } from "./cloud";
import { announceHeldAnswer, takeHeldAnswer } from "./held";
import { cloudCredentials, maskNumber } from "./index";
import { flushMediaBatch, noteMedia } from "./mediaBatch";
import { handleOnboarding, onboardingOffered } from "./onboarding";
import { clearPendingChannelAsk, hasPendingChannelAsk, markPendingChannelAsk } from "./pendingChannelAsk";
import { clearPendingProposal, holdProposal, peekPendingProposal, takePendingProposal } from "./pendingProposal";
import { isWhatsappExecutable, pressProposal } from "./proposalExecution";
import { BUTTON_TITLE_MAX, CONFIRM_NO_ID, CONFIRM_YES_ID, confirmButtonsFor, renderForWhatsapp, truncate } from "./render";
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

/** How long a gap gets a note folded in for the model to read — B1303. Well
 *  under the WhatsApp thread's own 24h TTL (`lib/helper/thread.ts`'s
 *  `TTL_MS.whatsapp`), so the system prompt's "long gap, new subject: ask"
 *  line has something to fire on long before the thread itself expires. */
const GAP_NOTE_HOURS = 4;

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
    const found = await contactFor(message.from);
    if (message.kind === "text" && isStopWord(message.body)) {
      if (found && isEnabled("whatsappInbound", found.username)) {
        const url = stopReplyFor(found.username, found.contactId);
        await sendServiceReply(message.from, translateIn(found.locale, "wa.stopReply", { url }), null);
        console.log(`[whatsapp:inbound] STOP from ${maskNumber(message.from)}, matched to ${found.username}'s contacts`);
        return;
      }
    }

    /**
     * Or this number has come to make a journal of its own — B1363, and the
     * reason the sentence below is no longer the end of the road. Two things
     * hold it back from everybody:
     *
     * - **An instance that cannot finish it never starts it**
     *   (`onboardingOffered`: `signup` and `mail`), so where signup is off
     *   this channel behaves exactly as it did before.
     * - **Somebody already known to a journal is not a stranger.** A reader
     *   who replies to a day announcement is in `listContacts` (the same scan
     *   the STOP branch above just made), and offering *them* a journal would
     *   be answering a nice word about somebody's holiday with a sign-up
     *   form. They get the sentence below, which is what they got before.
     */
    if (!found && onboardingOffered() && (await handleOnboarding(message))) return;

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
    /**
     * A fresh opt-in ask, in chat, rather than only a pointer elsewhere —
     * B1404. `username` here can only ever be the journal's own owner:
     * `journalForNumber()` two lines above resolves nothing but the tel
     * registry, whose sole writer is the owner's own proven number (see
     * `lib/registry.ts`). So there is no further identity check to make —
     * anybody else's number never reaches this branch at all, and falls
     * into the stranger path above instead.
     */
    const optInLocale = getUser(username)?.defaultLocale ?? "en";

    if (hasPendingChannelAsk(username, message.from)) {
      // Resolved either way, the moment the next message answers it — a
      // "yes" turns the channel on; anything else is read as "not now"
      // rather than re-asked, the same discipline `speechConsent.ts` uses.
      clearPendingChannelAsk(username, message.from);
      if (message.kind === "text" && isAcknowledgement(message.body, optInLocale)) {
        setJournalFeatures(username, { whatsappInbound: true });
        await sendServiceReply(message.from, translateIn(optInLocale, "wa.channelOnConfirmed"), null);
        console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) switched whatsappInbound on from chat`);
      } else {
        markTold(username, message.from, "channel-off");
        console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) declined the channel opt-in ask`);
      }
      return;
    }

    if (!hasBeenTold(username, message.from, "channel-off")) {
      const agentUrl = `${serverSite().url.replace(/\/$/, "")}/agent`;
      await sendServiceReply(message.from, translateIn(optInLocale, "wa.channelOffOptIn", { agentUrl }), null);
      markPendingChannelAsk(username, message.from);
      console.log(`[whatsapp:inbound] ${maskNumber(message.from)} matches ${username}, which has not opted into the channel — asked in chat`);
    }
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
   * The fallback half of B1240: a batch that never gets a quiet moment
   * answers the instant the sender moves on to something else, rather than
   * staying silent because the window keeps resetting. Every kind but a
   * photo or a document reaching here counts as "moved on" — including a
   * held answer or the greeting a few lines down, both of which are
   * themselves things this number just said in a sense.
   */
  if (message.kind !== "image" && message.kind !== "document") {
    await flushMediaBatch(username, message.from);
  }

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
    /**
     * A miss used to be total silence — B1302, scenario-margrit.md finding 4.
     * A 71-year-old told "reply with 'ja' to continue" who typed a warm,
     * natural "jaa gerne" instead had no way to tell "the AI is thinking"
     * from "the AI never got this". One short reminder, said once per
     * number (not on every miss — a person still finding the right words
     * for "yes" should not be nagged on each try), rather than loosening the
     * exact match itself.
     */
    if (!hasBeenTold(username, message.from, "consentReminder")) {
      await sendServiceReply(message.from, translateIn(locale, "wa.consentReminder"), username);
      markTold(username, message.from, "consentReminder");
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
   * "new chat" / "neues gespräch" — B1245, matched before the model exactly
   * as `wa.yes` is (B1138) rather than left for the model to notice and
   * call nothing for. `forget()` is the whole of "ends the live session
   * cleanly" — B1054/B1168's own mechanism: the `helper_threads` row for
   * this journal is cleared, so the very next message mints a fresh
   * `sessionId()` rather than continuing the old one. The old conversation
   * is not deleted — `helper_sessions` keeps every turn it ever had, which
   * is what makes it reachable again from `/agent`'s history panel.
   */
  if (message.kind === "text" && isNewChatCommand(message.body, locale)) {
    forget(username);
    // B1303, scenario-multimsg.md defect 2 — a proposal made before the
    // reset is not a proposal this fresh thread ever made. Without this, a
    // stale `confirm:0:yes` tap after "neues gespräch" silently wrote into
    // the new, nominally-empty conversation.
    clearPendingProposal(username, message.from);
    const url = `${serverSite().url}/agent`;
    await sendServiceReply(message.from, translateIn(locale, "wa.newChatStarted", { url }), username);
    console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) started a fresh conversation`);
    return;
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

  /**
   * A typed press — B1302, scenario-margrit.md's headline finding. Nothing
   * mechanical ever recognised somebody typing a proposal's own button label
   * back instead of tapping it, so the turn reached the model with the write
   * already "described" as done and nothing left to do — the exact
   * "Der Text ist gespeichert" shape AGENTS.md names. Compared here, before
   * any model call, against the three strings a typed reply could honestly
   * mean: the button's own (truncated) title, the full accept sentence
   * underneath it, and the decline word — anything else falls through to the
   * model exactly as before.
   */
  if (message.kind === "text") {
    const pending = peekPendingProposal(username, message.from);
    if (pending) {
      const typed = message.body.trim().toLowerCase();
      const declineWord = translateIn(locale, "wa.declineButton").trim().toLowerCase();
      const acceptFull = pending.accept.trim().toLowerCase();
      const acceptShown = truncate(pending.accept, BUTTON_TITLE_MAX).trim().toLowerCase();
      if (typed !== "" && (typed === declineWord || typed === acceptFull || typed === acceptShown)) {
        await handleProposalReply(username, locale, message.from, typed !== declineWord);
        return;
      }
    }
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
    // B1271 — the same silent drop B1263 fixed for handleMedia: a sender
    // whose voice note failed to download got nothing back and could not
    // tell a real failure from "still typing…".
    await sendServiceReply(message.from, translateIn(locale, "wa.mediaDownloadFailed"), username);
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
    // B1263 — a sender who just sent a photo and gets nothing back cannot
    // tell a real failure from "still typing…". One honest sentence, rather
    // than the silence this used to leave.
    await sendServiceReply(message.from, translateIn(locale, "wa.mediaDownloadFailed"), username);
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

  // Checked and written under the same per-username lock every other upload
  // door uses (B1556): a phone that sends several photographs in a burst is
  // several of these calls in flight together, and the check alone would let
  // all of them pass before any had written a byte.
  const guard = await withStorageQuota(username, downloaded.data.byteLength, () =>
    storeInboxFile(username, kind, filename, downloaded.data, {
      ...(message.caption ? { caption: message.caption } : {}),
      source: "whatsapp",
      receivedAt: new Date(Number(message.timestamp) * 1000 || Date.now()).toISOString(),
    }),
  );
  if (!guard.ok) {
    await sendServiceReply(message.from, guard.problem, username);
    return;
  }
  const stored = guard.value;

  const topic = message.kind === "document" ? "document" : "photo";
  // One reply for the whole batch, not one per item — B1240. Resets a short
  // window rather than answering instantly; `flushMediaBatch` (called on the
  // next non-media message) is the fallback if the sender never pauses.
  noteMedia(username, message.from, locale, topic);
  console.log(
    `[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — ${message.kind} landed in the inbox as ${stored.entry.id}`,
  );
}

/**
 * A location pin — B1074, revised.
 *
 * Auto-attaching a pin to a day (or starting one) guessed which day a
 * coordinate was for from the message's own arrival time, which is not
 * something WhatsApp actually tells you and not something the sender said.
 * This lands the reading in the inbox instead — the same bucket a photo
 * lands in — and says so, so a person still decides which day it belongs to.
 */
async function handleLocationPin(
  username: string,
  locale: string,
  message: Extract<InboundMessage, { kind: "location" }>,
): Promise<void> {
  storeInboxFile(
    username,
    "location",
    `location-${message.timestamp}.json`,
    Buffer.from(JSON.stringify({ lat: message.latitude, lon: message.longitude })),
    {
      lat: message.latitude,
      lon: message.longitude,
      source: "whatsapp",
      receivedAt: new Date((Number(message.timestamp) || Date.now() / 1000) * 1000).toISOString(),
    },
  );
  await sendServiceReply(message.from, translateIn(locale, "wa.locationSaved"), username);
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

  const say = sayIn(locale);
  const today = new Date().toISOString().slice(0, 10);

  /**
   * A turn has no sense of time otherwise — B1303, scenario-edges.md
   * finding 6. The system prompt has always promised "long gap, new
   * subject: ask — continue, or fresh" with nothing behind it: `Turn`
   * carries no timestamp, so this is what actually gives the model
   * something to read. Folded in the same way any other note is — riding on
   * this turn's own message — rather than persisted, since it is a fact
   * about *when this turn is happening*, true once and never again.
   */
  const touched = await lastTouched(username);
  // Copied rather than mutated in place — `history()` hands back the live
  // thread's own array, and this note is true of this turn only, never
  // meant to persist into the next one.
  const turns = [...(await history(username))];
  if (touched !== null) {
    const hours = Math.round((Date.now() - touched) / (60 * 60 * 1000));
    if (hours >= GAP_NOTE_HOURS) {
      turns.push({ role: "note", text: `[gap: about ${hours} hours since the last message]` });
    }
  }

  // The credit, before the model — B1091, the same gate `answerInThread`'s
  // other two callers (`/ask` and `/search`) use, and the same reason: a
  // turn nothing can pay for must never reach a provider.
  const ledgerRef = `${username}/whatsapp-ask/${Date.now()}`;
  if (!(await spend(username, HELPER_TURN_CREDITS, "ask_thread", ledgerRef))) {
    const balance = (await balanceOf(username)) ?? 0;
    const url = `${serverSite().url}/${username}/account`;
    await sendServiceReply(to, noCreditsAnswer(say, balance, url), username);
    console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) refused: no_credits (ask_thread)`);
    return;
  }

  let thread;
  try {
    thread = await answerInThread(username, said, turns, today, say, [], locale, "whatsapp");
  } catch (err) {
    // The credit bought nothing — B1091, the same refund the web door gives.
    await refund(username, HELPER_TURN_CREDITS, ledgerRef);
    console.error(`[whatsapp:inbound] model turn failed for ${username}:`, err);
    return;
  }
  if (thread.answer === "" && thread.blocks.length === 0) return;

  for (const proposal of thread.proposals) proposed(username, proposal.tool, proposal.arguments, "whatsapp");

  // At most one write proposal reaches a WhatsApp screen at a time in
  // practice — the model calls one write tool a turn — so the first is the
  // one a tap can be about; see the module doc above `holdProposal`.
  const proposal = thread.proposals[0];
  /**
   * What the link actually opens on — B1242.
   *
   * `?c=<id>` alone lands somebody in the conversation with nothing summoned
   * (`components/HelperRoom.tsx`'s preview rail only draws once a `subject`
   * is set, and nothing on arrival sets one from `?c=` by itself). The room
   * already honours `?about=<trip>/<slug>` for exactly this — B994's link
   * from a day — so the fix is naming the day this turn was about, not a new
   * mechanism: a proposal whose arguments already carry a resolved `trip`
   * and `slug` (attach a photo, write a day up, add a cost — everything past
   * `start_day`, which has no slug yet to name) is the day the preview
   * should open on.
   */
  const about =
    proposal && proposal.arguments.trip && proposal.arguments.slug
      ? `&about=${encodeURIComponent(proposal.arguments.trip)}/${encodeURIComponent(proposal.arguments.slug)}`
      : "";
  // The session link, not the bare room — B1237. `/agent?c=<id>` (built the
  // same way the greeting's own `agentUrl` above already is) adopts this
  // exact conversation; a bare `/agent` opens the room to a stranger who has
  // to start over, which is worse than a link doing nothing at all.
  const journalUrl = `${serverSite().url}/agent?c=${await sessionId(username, "whatsapp")}${about}`;
  const declineLabel = translateIn(locale, "wa.declineButton");

  /**
   * A turn that proposes more than once — B1261, scenario-guards.md finding
   * 2. The pending-proposal store holds exactly one waiting write per
   * number, so only `proposal` (the first) can ever be pressed from here.
   * Every other write's `confirm`/`form` block is turned into plain prose
   * with its own honest next-step, *before* rendering — rather than drawing
   * buttons a tap could never find (`pendingProposal.ts`'s take-once read
   * only ever has room for one).
   */
  const blocks = [
    ...thread.blocks.map((block) => {
      if ((block.shape !== "confirm" && block.shape !== "form") || !block.proposal || block.proposal === proposal) {
        return block;
      }
      return {
        shape: "say" as const,
        text: `${block.text} ${translateIn(locale, "wa.secondProposalNote", { url: journalUrl })}`,
      };
    }),
    ...(thread.answer === "" ? [] : [{ shape: "say" as const, text: thread.answer }]),
  ];

  const moreText = translateIn(locale, "wa.moreInThread");
  const messages = renderForWhatsapp(blocks, journalUrl, declineLabel, moreText);

  if (proposal) {
    const taggedIndex = messages.findIndex((message) => message.proposal === proposal);
    const tagged = taggedIndex === -1 ? undefined : messages[taggedIndex];
    if (tagged?.kind === "buttons") {
      // A `confirm` block already drew these buttons (B1056) — hold the
      // proposal so a tap on them can find it. Whether the tap goes on to
      // execute or is told this lives on the web is `handleProposalReply`'s
      // question, not this one's.
      holdProposal(username, to, proposal);
    } else if (tagged && isWhatsappExecutable(proposal.tool)) {
      /**
       * A `form`-shaped proposal (B1230's own case: `create_trip` is exactly
       * this) had no WhatsApp shape before B1230. Since B1304,
       * `renderForWhatsapp` flushes it onto its own tagged message rather
       * than folding it into whatever else the turn drew — found by tag
       * here, not by position ("the last message"), which is what used to
       * merge a second proposal's own prose onto the first's buttons. Upgrade
       * that one message to real buttons, over whatever text it already
       * carries, and nothing else in the turn.
       */
      messages[taggedIndex] = {
        ...confirmButtonsFor(tagged.kind === "text" ? tagged.body : "", proposal.accept, declineLabel),
        proposal,
      };
      holdProposal(username, to, proposal);
    }
    // A `form`-shaped proposal for a tool this channel will never press
    // (a postcard, a photobook) keeps its pre-B1230 text-and-link shape —
    // no button is offered for a press that could not do anything.
  }

  // B1261 — what the person actually saw, not the model's own undropped
  // prose, is what the conversation and the diagnostic log both remember
  // from here on: every message this turn actually sent, joined the same
  // way a person reads several bubbles in a row.
  const delivered = messages.map((message) => message.body).join("\n\n");
  remember(username, said, delivered, "whatsapp");
  void recordTurn({
    owner: username,
    session: await sessionId(username, "whatsapp"),
    locale,
    tools: thread.looked,
    proposed: thread.proposals.map((one) => one.tool),
    guard: thread.guard,
    recovered: thread.recovered,
    threadTurns: (await history(username)).length,
    said,
    answered: delivered,
    origin: "whatsapp",
  });

  for (const message of messages) await sendOutboundReply(to, message, username);
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
/**
 * What one write here costs on the press itself, for the one sentence that
 * needs to say so — B1235. Only `draft_words` spends on the press today (a
 * fixed credit, `WRITE_DAY_CREDITS`); a tool absent from this map still
 * refuses `"no_credits"` correctly, just with the plainer, cost-free
 * sentence, because there is nothing here to compute its price from.
 */
const CREDIT_COST_BY_TOOL: Record<string, number> = { draft_words: WRITE_DAY_CREDITS };

/**
 * The two tools a press of which really puts words on a day — B1264.
 *
 * `draft_words` writes nothing (see the module doc in
 * `app/api/helper/[user]/day/write-day/route.ts`): it only returns prose for
 * `set_day_words` to keep on a later press, so a nudge on *its* press would
 * be reading a day that has not changed yet. The date/slug a nudge needs to
 * find the day is what each of these two proposals' own `arguments` already
 * carries — `start_day`'s `date` (always concrete: `resolveTrip`/
 * `firstUnwritten` filled it in before the card was ever shown) and
 * `set_day_words`'s `slug`.
 */
const DAY_WRITE_TOOLS: Record<string, "date" | "slug"> = { start_day: "date", set_day_words: "slug" };

/**
 * One short question, appended to the fixed confirmation, when the day this
 * press just touched verifiably still lacks something — B1264.
 *
 * Mechanical rather than prompted: B1244's own prompt line asking the model
 * to do this "sometimes, gently" never fired in a live run
 * (scenario-dayflow.md step 5). This reads the day straight back off disk
 * after the write, the same way every honesty guard in `lib/helper/model.ts`
 * checks a claim against the turn rather than trusting it — so the question
 * only ever follows a day that is really missing the thing it asks about,
 * and a day that explicitly declined one (`without:`) is never re-asked.
 *
 * At most one question, in this order: no coordinates first (the more useful
 * of the two to have early — costs can be added long after), then costs.
 * Weather is never asked for — it is the server's own lookup, never a
 * question to the person (AGENTS.md).
 */
function enrichmentNudge(username: string, locale: string, pending: Proposal): string | null {
  const key = DAY_WRITE_TOOLS[pending.tool];
  if (!key) return null;
  const tripId = pending.arguments.trip;
  const wanted = pending.arguments[key];
  if (!tripId || !wanted) return null;

  const ref = tripRef(username, tripId);
  const entry = getAllEntries(ref, AS_AUTHOR).find((one) => (key === "date" ? one.date === wanted : one.slug === wanted));
  if (!entry) return null;

  const facts = factsOfEntry(entry);
  if (!facts.coordinates && !facts.without.includes("coordinates")) {
    return translateIn(locale, "wa.enrichLocation");
  }
  if (!facts.costs && !facts.without.includes("costs")) {
    return translateIn(locale, "wa.enrichCosts");
  }
  return null;
}

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
    const nudge = enrichmentNudge(username, locale, pending);
    const body = nudge ? `${pending.done}\n\n${nudge}` : pending.done;
    await sendOutboundReply(to, { kind: "text", body }, username);
    console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) pressed ${pending.tool} from WhatsApp`);
    return;
  }

  // A write that cannot pay is said plainly — B1061's own decision, one
  // sentence naming what it would have cost and what the balance is, the
  // same shape `balanceRefusal` already gives a voice note that cannot pay.
  const cost = CREDIT_COST_BY_TOOL[pending.tool];
  if (result.error === "no_credits" && cost !== undefined) {
    const balance = (await balanceOf(username)) ?? 0;
    await sendOutboundReply(to, { kind: "text", body: balanceRefusal(locale, username, cost, balance) }, username);
    console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) press of ${pending.tool} refused: no_credits`);
    return;
  }

  const key = result.error === "web_only" ? "wa.proposalWebOnly" : "wa.proposalFailed";
  await sendOutboundReply(to, { kind: "text", body: translateIn(locale, key, { error: result.error }) }, username);
  console.log(`[whatsapp:inbound] ${maskNumber(to)} (${username}) press of ${pending.tool} refused: ${result.error}`);
}
