import "server-only";
import { isEnabled } from "../capabilities";
import { getUser } from "../users";
import { translateIn } from "../locales";
import { journalForNumber } from "../registry";
import { serverSite } from "../site";
import { hasBeenGreeted, markGreeted } from "./binding";
import { maskNumber } from "./index";
import { sendServiceReply } from "./reply";
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

  if (!hasBeenGreeted(username, message.from)) {
    const user = getUser(username);
    const locale = user?.defaultLocale ?? "en";
    const journalUrl = `${serverSite().url}/${username}`;
    const reply = translateIn(locale, "wa.firstReply", { journalUrl });
    await sendServiceReply(message.from, reply, username);
    markGreeted(username, message.from);
    console.log(`[whatsapp:inbound] greeted a newly bound number for ${username}`);
    return;
  }

  // An already-bound, already-greeted number's ordinary message. No model
  // turn exists yet to answer it with (B1056) — logged, not dropped, so a
  // person reading the server's log can see the channel is alive.
  console.log(`[whatsapp:inbound] ${maskNumber(message.from)} (${username}) — ${message.kind} (${message.id})`);
}
