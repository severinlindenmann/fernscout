import "server-only";
import { issueSignupResumeLink, signupResumeUrl } from "./auth";
import { isEnabled } from "./capabilities";
import { getDatabaseOrNull } from "./db";
import { journalsOwnedBy } from "./journals";
import { translateIn } from "./locales";
import { sendMail } from "./mail";
import { letInMail } from "./mail/letInMail";
import { serverSite } from "./site";
import type { Locale } from "./types";

/**
 * What the operator's "Invite this address" did about telling the person —
 * B-2772. `off`: this server sends no mail, so the operator tells them.
 */
export type ApprovalMail = "sent" | "failed" | "off" | "has_journal";

/**
 * The "You're in" mail for an address just added to the invite list.
 *
 * The button is the signup-resume link of B2781 and nothing new: a
 * `signup-resume` row bound to the address, single use, seven days, spent by
 * a press on `/welcome/r/<token>` (never by a GET), which re-checks the invite
 * list and the journal cap and answers with a signup token in the body — no
 * cookie. So a forwarded mail can start at most the one journal this address
 * is allowed. It is the code mail's own link kind because the two must behave
 * identically; a second kind would be a second thing to keep in step.
 *
 * Never throws: the list entry is already written and the admin page reports
 * what happened to the mail.
 */
export async function sendInviteApprovalMail(email: string, locale: string | null): Promise<ApprovalMail> {
  if (!isEnabled("mail")) return "off";
  // The press would end in too_many_journals; say so instead of mailing it.
  if (journalsOwnedBy(email).length > 0) return "has_journal";
  const loc = (locale ?? "en") as Locale;
  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(loc, key, vars);
  try {
    const linkToken = await issueSignupResumeLink(email);
    const sent = await sendMail(
      letInMail({
        to: email,
        locale: loc,
        subject: t("inviteApproved.subject", { site: site.name }),
        title: t("inviteApproved.title"),
        body: t("inviteApproved.body", { site: site.name }),
        buttonText: t("inviteApproved.button"),
        buttonUrl: signupResumeUrl(site.url, linkToken, loc, true),
        why: t("inviteApproved.why", { site: site.name }),
      }),
    );
    return sent ? "sent" : "off";
  } catch (err) {
    console.error("[invite] approval mail could not be sent:", err);
    return "failed";
  }
}

/** The language the person asked in at `/invite`, if they ever did. */
export async function inviteRequestLocale(email: string): Promise<string | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("invite_requests")
    .select("locale")
    .where("email", "=", email.trim().toLowerCase())
    .executeTakeFirst();
  return row?.locale ?? null;
}
