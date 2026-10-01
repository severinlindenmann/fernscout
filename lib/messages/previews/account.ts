import { translateIn } from "../../locales";
import { composeCodeMail, composeRequestMail } from "../../contacts/mail";
import {
  composeIdentityCodeMail,
  composeJournalCodeMail,
  composeOwnerEmailCodeMail,
  composeOwnerEmailMovedMail,
} from "../../mail/accountCodeCompositions";
import { composeInviteMail } from "../../mail/inviteMail";
import { composeLetInMail } from "../../mail/letInMail";
import { composeOperatorMessageMail } from "../../mail/operatorMessage";
import { composeDeletionMail, composeExportMail } from "../../deletions";
import { composeWaitlistMail } from "../../appWaitlist";
import { composeInviteRequestMail } from "../../inviteRequest";
import { composeWelcomeMail } from "../../journals";
import { composeStorageMail } from "../../storageQuota";
import { composeExpiryFinalMail, composeExpiryWarnMail } from "../../staging/expiry";
import { composeSignupCodeMail, requestedAt } from "../../signupCode";
import { SAMPLE } from "./sample";
import type { PreviewMap } from "./types";

/** An obviously-fake link — never a real token, never a real username. */
const SAMPLE_LINK = "https://fernscout.ch/@example/s/k3x9";
const SAMPLE_USER = "example";
const SAMPLE_EMAIL = "preview@example.invalid";

/**
 * B2493 group A — sign-in, invite and account notice mail. Every entry
 * calls the exact composer its send site calls (`composeCodeMail`,
 * `composeInviteMail`, …) with `SAMPLE` values, so a preview can never say
 * something the real send would not.
 */
export const accountPreviews: PreviewMap = {
  "code.mail": (locale) =>
    composeCodeMail({
      title: SAMPLE.journal,
      locale,
      code: SAMPLE.code,
      link: SAMPLE_LINK,
    }),

  "code.identity.mail": (locale) =>
    composeIdentityCodeMail({ locale, code: SAMPLE.code, site: SAMPLE.site, link: SAMPLE_LINK }),

  "code.journal.mail": (locale) =>
    composeJournalCodeMail({
      locale,
      code: SAMPLE.code,
      siteName: SAMPLE.site,
      title: SAMPLE.journal,
      for: "read",
      link: SAMPLE_LINK,
      askedAt: requestedAt(locale),
    }),

  "code.signup.mail": (locale) =>
    composeSignupCodeMail({ locale, code: SAMPLE.code, askedAt: requestedAt(locale) }),

  "code.ownerEmail.mail": (locale) =>
    composeOwnerEmailCodeMail({ locale, code: SAMPLE.code, siteName: SAMPLE.site, title: SAMPLE.journal }),

  // B2597: the owner's own signup/phone-verify text (`lib/phoneVerify/sms.ts`)
  // — the only sender left for `code.sms` since readers sign in by email
  // only now.
  "code.sms": (locale) => ({
    channel: "sms",
    text: translateIn(locale, "code.phoneVerify", { code: SAMPLE.code, site: SAMPLE.site }),
  }),

  "invite.mail": (locale) => {
    const vars = { title: SAMPLE.journal, nickname: SAMPLE.owner, trip: "" };
    return composeInviteMail({
      to: SAMPLE_EMAIL,
      locale,
      subject: translateIn(locale, "contact.mailInviteGuestSubject", vars),
      title: translateIn(locale, "contact.mailInviteTitle"),
      body: translateIn(locale, "contact.mailInviteGuestBody", vars),
      buttonText: translateIn(locale, "contact.mailInviteButton"),
      buttonUrl: SAMPLE_LINK,
      why: translateIn(locale, "mail.why.invite", { site: SAMPLE.journal }),
    });
  },

  "invite.in.mail": (locale) =>
    composeLetInMail({
      to: SAMPLE_EMAIL,
      locale,
      subject: translateIn(locale, "contact.mailApprovedSubject", { title: SAMPLE.journal }),
      title: translateIn(locale, "contact.mailApprovedTitle"),
      body: translateIn(locale, "contact.mailApprovedBody", { title: SAMPLE.journal, trip: "" }),
      buttonText: translateIn(locale, "contact.mailApprovedButton", { title: SAMPLE.journal }),
      buttonUrl: SAMPLE_LINK,
      why: translateIn(locale, "mail.why.reader", { site: SAMPLE.journal }),
      items: [
        {
          title: translateIn(locale, "contact.mailManageButton"),
          meta: translateIn(locale, "contact.mailManageCaption"),
          href: SAMPLE_LINK,
        },
      ],
    }),

  "notice.request": (locale) =>
    composeRequestMail({
      username: SAMPLE_USER,
      title: SAMPLE.journal,
      locale,
      contactId: "c1",
      name: SAMPLE.name,
      email: SAMPLE_EMAIL,
    }),

  "notice.delete": (locale) =>
    composeDeletionMail({
      summary: {
        kind: "journal",
        username: SAMPLE_USER,
        title: SAMPLE.journal,
        journalTitle: SAMPLE.journal,
        trips: 3,
        days: 12,
        files: 214,
        bytes: 512_000_000,
      },
      nickname: SAMPLE.owner,
      token: "k3x9",
      locale,
    }),

  "notice.export": (locale) =>
    composeExportMail({ username: SAMPLE_USER, title: SAMPLE.journal, nickname: SAMPLE.owner, token: "k3x9", locale }),

  "notice.moved": (locale) =>
    composeOwnerEmailMovedMail({ locale, siteName: SAMPLE.site, title: SAMPLE.journal, newEmail: SAMPLE_EMAIL }),

  "notice.storage": (locale) =>
    composeStorageMail({ username: SAMPLE_USER, locale, usedBytes: 5_000_000_000, limitBytes: 5_000_000_000, full: true }),

  "notice.waitlist": (locale) => composeWaitlistMail(locale),

  "notice.inviteRequest": (locale) => composeInviteRequestMail(locale),

  "notice.welcome": (locale) =>
    composeWelcomeMail({
      username: SAMPLE_USER,
      title: SAMPLE.journal,
      email: SAMPLE_EMAIL,
      nickname: SAMPLE.owner,
      visibility: "guest",
      locale,
      signIn: SAMPLE_LINK,
    }),

  "notice.expiryWarn": (locale) =>
    composeExpiryWarnMail({
      locale,
      siteTitle: SAMPLE.journal,
      photoCount: 24,
      started: "2026-09-01",
      daysLeft: 24,
    }),

  "notice.expiryFinal": (locale) =>
    composeExpiryFinalMail({ locale, siteTitle: SAMPLE.journal, unusedPhotoCount: 8 }),

  "notice.operatorMessage": () =>
    composeOperatorMessageMail({
      subject: "A note about your journal",
      text: "Just checking in about your storage usage.\n\nLet us know if you have questions.",
      siteName: SAMPLE.site,
      username: SAMPLE_USER,
    }),
};
