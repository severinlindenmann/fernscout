import "server-only";
import webpush, { WebPushError } from "web-push";
import { isEnabled } from "../capabilities";
import { getContact } from "../contacts";
import { isGoneSubscription, removeSubscriptions } from "../push";
import type { StoredSubscription } from "../repos/types";
import { sendApnsNotification } from "./apns";
import { logMessage } from "../messages/log";
import type { TemplateId } from "../messages/registry";
import { isSwitchedOff } from "../messages/switches";

/**
 * The one place a push notification actually leaves the server — B2448.
 *
 * `scripts/notify.mts` used to be the only caller of `web-push` and
 * `sendApnsNotification`, which meant a subscriber only ever heard about a
 * new day when somebody ran it by hand. This is that same fan-out, callable
 * from a route (`publish`) as well as the script, and — like every optional
 * capability — a no-op rather than a throw when it cannot run: no VAPID
 * environment, or `push` switched off, silently sends nothing rather than
 * failing a publish that has nothing to do with notifications.
 *
 * One call sends the *same rendered* title/body to every subscription handed
 * to it — the caller resolves each subscriber's locale and groups by it
 * (`localeForSubscriber` below plus a `translateIn` call), so this file never
 * needs to know a template exists. `subscriptions` accepts a bare one so a
 * single-subscriber caller (a resend, a test) needs no array wrapper.
 */

let vapidReady: string | null = null;

/** Configures `web-push` once per key set; returns false when web push
 * cannot run at all (no env, or malformed keys) rather than throwing, since
 * an absent capability must leave publish untouched (AGENTS.md). */
function ensureVapid(): boolean {
  if (!isEnabled("push")) return false;
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  if (vapidReady === VAPID_PUBLIC_KEY) return true;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:hello@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = VAPID_PUBLIC_KEY;
    return true;
  } catch {
    return false;
  }
}

/**
 * A subscriber's language for a localized payload — their contact's
 * `locale`, else `en`. `null` for an anonymous device (no `contactId`, the
 * common case on an open trip) or when the lookup fails for any reason:
 * never a reason to fail the whole send.
 *
 * Deliberately not in `lib/push.ts`, which documents on `subscribersFor`
 * that it does not import `lib/contacts` (see docs/plans/W12-push.md) — this
 * file is a different one and carries no such constraint.
 */
export async function localeForSubscriber(username: string, sub: StoredSubscription): Promise<string> {
  if (!sub.contactId) return "en";
  try {
    const contact = await getContact(username, sub.contactId);
    return contact?.locale ?? "en";
  } catch {
    return "en";
  }
}

export type PushOutcome = { sent: number; pruned: number };

/**
 * Send one already-localized notification to one or several subscriptions of
 * the same journal.
 *
 * `template` names the message-log template id this send belongs to (for
 * example `news.push`), so every outcome below writes one `message_log` row
 * (B2438) without the caller repeating it. `locale` is carried through only
 * for that log, since `title`/`body` are already rendered text by the time
 * they reach here.
 */
export async function sendPush(params: {
  template: TemplateId;
  subscriptions: StoredSubscription | StoredSubscription[];
  title: string;
  body: string;
  url: string;
  tag: string;
  locale: string;
}): Promise<PushOutcome> {
  const subs = Array.isArray(params.subscriptions) ? params.subscriptions : [params.subscriptions];
  if (subs.length === 0) return { sent: 0, pruned: 0 };

  // The operator's own per-message-kind switch (B2446) — never true for a
  // required family. See lib/messages/switches.ts.
  if (await isSwitchedOff(params.template)) {
    await Promise.all(
      subs.map((sub) =>
        logMessage({
          template: params.template,
          channel: "push",
          to: sub.endpoint,
          owner: sub.username,
          locale: params.locale,
          status: "skipped",
          reason: "switched_off:operator",
        }),
      ),
    );
    return { sent: 0, pruned: 0 };
  }

  const notice = { title: params.title, body: params.body, url: params.url, tag: params.tag };
  const payload = JSON.stringify(notice);
  const canWeb = ensureVapid();

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (sub) => {
      if (sub.kind === "apns") {
        try {
          const result = await sendApnsNotification({ token: sub.endpoint, ...notice });
          if (result.ok) {
            sent++;
            await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "sent" });
          } else if (result.gone) {
            dead.push(sub.endpoint);
            await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "failed", reason: "gone" });
          } else {
            await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "failed", reason: String(result.status) });
          }
        } catch {
          // Best-effort — nothing here can escalate an apns failure further.
          await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "failed", reason: "error" });
        }
        return;
      }

      if (!canWeb) return; // Absent capability ⇒ silently nothing, not a throw.
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
        sent++;
        await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "sent" });
      } catch (err) {
        if (isGoneSubscription(err)) {
          dead.push(sub.endpoint);
          await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "failed", reason: "gone" });
        } else {
          const reason = String(err instanceof WebPushError ? err.statusCode : "?");
          console.error(`[push] ${reason} sending to ${sub.endpoint}`);
          await logMessage({ template: params.template, channel: "push", to: sub.endpoint, owner: sub.username, locale: params.locale, status: "failed", reason: reason });
        }
      }
    }),
  );

  if (dead.length > 0) {
    // Every subscription passed to one call belongs to one journal — the
    // same assumption `scripts/notify.mts` already made per run.
    await removeSubscriptions(subs[0].username, dead);
  }

  return { sent, pruned: dead.length };
}
