import "server-only";
import { isEnabled } from "../capabilities";
import { balanceOf } from "../credits";
import { getUser } from "../users";
import { currentHelperProvider, hasHelperConsent, recordHelperConsent } from "../helper/consent";
import type { Say } from "../helper/intents";
import { answerInThread } from "../helper/model";
import { recordTurn } from "../helper/sessions";
import { MAX_AUDIO_BYTES, MAX_SPEECH_SECONDS, speechLanguageFor } from "../helper/speech";
import { history, proposed, remember, sessionId } from "../helper/thread";
import { spendAndTranscribe } from "../helper/transcribeSpend";
import { translateIn } from "../locales";
import { journalForNumber } from "../registry";
import { serverSite } from "../site";
import { isAcknowledgement } from "./acknowledge";
import { hasAcknowledged, hasBeenGreeted, markAcknowledged, markGreeted } from "./binding";
import { downloadMedia } from "./cloud";
import { takeHeldAnswer } from "./held";
import { cloudCredentials, maskNumber } from "./index";
import { renderForWhatsapp } from "./render";
import { balanceRefusal } from "./refusal";
import { sendOutboundReply, sendServiceReply } from "./reply";
import { clearPendingSpeechAsk, hasPendingSpeechAsk, markPendingSpeechAsk } from "./speechConsent";
import { markInbound } from "./window";
import type { InboundMessage } from "./inbound";

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
  const username = journalForNumber(message.from);

  if (!username) {
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
    await sendOutboundReply(message.from, held.outbound, username);
    console.log(`[whatsapp:inbound] delivered a held answer to ${maskNumber(message.from)} (${username}), held since ${held.heldAt}`);
  }

  if (!hasBeenGreeted(username, message.from)) {
    const journalUrl = `${serverSite().url}/${username}`;
    const reply = translateIn(locale, "wa.firstReply", { journalUrl });
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
 * its label" rule, extended to `confirm` here — see `lib/whatsapp/render.ts`'s
 * module doc for why a confirm's accept button never itself writes anything),
 * or a voice note's transcript, echoed back first (B1060). Every other kind
 * — a photograph, a location, a shared contact — is somebody else's ticket
 * (B1059, B1074) and never reaches this function.
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
    thread = await answerInThread(username, said, await history(username), today, say, []);
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
  for (const proposal of thread.proposals) proposed(username, proposal.tool, proposal.arguments);

  const blocks = [...thread.blocks, ...(thread.answer === "" ? [] : [{ shape: "say" as const, text: thread.answer }])];
  const journalUrl = `${serverSite().url}/agent`;
  await sendOutboundReply(to, renderForWhatsapp(blocks, journalUrl), username);
}
