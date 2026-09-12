import "server-only";
import { CODE_TTL_MINUTES, NO_JOURNAL, issueCode, revokeCodes } from "./auth";
import { translateIn } from "./locales";
import { sendMail } from "./mail";
import { renderMail } from "./mail/template";
import { serverSite } from "./site";

/**
 * The one-time code that proves somebody can read an address, on its way to
 * making a journal — step one of signup, wherever signup is being done.
 *
 * Lifted out of the old `app/api/auth/signup/request/route.ts` (now
 * `app/api/auth/codes/route.ts`'s `for: "signup"` branch) by B1363, which gave
 * the flow a second door: the WhatsApp onboarding
 * (`lib/whatsapp/onboarding.ts`) has to mail the identical code, in the
 * identical letter. Two copies of a code mail is two subjects, two TTLs and
 * two answers to what happens when the send fails — and the third of those
 * is the one that matters, so it is written down once here rather than twice
 * badly.
 *
 * **A failed send takes the code back with it.** The row is written before
 * the mail goes out, and issuing one supersedes every earlier code for the
 * address; without the revoke, a failed attempt silently kills the code the
 * person may still be holding and leaves a live one nobody has ever been
 * told. That is how a signup ends with `invalid_code` on a code somebody
 * read out correctly. The route's own comment is where this was found.
 */
export async function sendSignupCode(email: string, locale: string): Promise<boolean> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");

  const site = serverSite();
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) =>
    translateIn(locale as Parameters<typeof translateIn>[0], key, vars);
  const vars = { site: site.name, code, minutes: CODE_TTL_MINUTES };

  try {
    await sendMail(
      renderMail(email, t("mail.signupSubject", vars), {
        preheader: t("mail.identityCode", vars),
        title: t("mail.signupTitle"),
        blocks: [
          { kind: "paragraph", text: t("mail.identityCode", vars) },
          { kind: "paragraph", text: t("mail.signupWhat") },
          // The timestamp is what makes two identical mails tellable apart.
          // Asking again invalidates the earlier code and sends a mail that is
          // word for word the same, so without a stamp the person reads out
          // whichever is nearest and gets `invalid_code` for their trouble.
          { kind: "paragraph", text: t("mail.codeAsked", { when: requestedAt(locale) }) },
          { kind: "paragraph", text: t("mail.signupIgnore") },
        ],
        footer: t("mail.identityFooter", vars),
      }),
    );
  } catch (err) {
    console.error("[auth] signup code could not be sent:", err);
    await revokeCodes(NO_JOURNAL, email, "signup").catch(() => {});
    return false;
  }
  return true;
}

/** `14:32 UTC, 1 September` — enough to tell two identical mails apart,
 * without pretending to know the reader's timezone. The month is written in
 * the reader's own language (B857); the comma stands in for the English "on"
 * so no word of glue has to be translated. */
function requestedAt(locale: string): string {
  const now = new Date();
  const time = now.toISOString().slice(11, 16);
  const day = now
    .toLocaleDateString(locale === "en" ? "en-GB" : locale, {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    })
    // Hungarian writes the day as "szeptember 7." — full stop included — and
    // the sentence this lands in ends with one of its own. Two in a row reads
    // like a typo in a mail whose whole job is to look trustworthy.
    .replace(/\.$/, "");
  return `${time} UTC, ${day}`;
}
