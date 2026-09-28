import "server-only";
import { CODE_TTL_MINUTES } from "../auth";
import { translateIn } from "../locales";
import type { Composition } from "../messages/previews/types";
import type { Locale } from "../types";
import { composeCodeMailContent } from "./codeMail";
import type { MailBlock } from "./template";

type MailComposition = Extract<Composition, { channel: "mail" }>;

/** Deliberately not a `code.*` mail — kept here anyway, next to
 * `composeOwnerEmailCodeMail`, since both belong to the same owner-email
 * change flow. Mirrors `notifyOldOwnerAddress` in
 * `app/api/v2/[user]/owner/email/redeem/route.ts` — the OLD address hearing
 * that the journal moved to a new one. */
export function composeOwnerEmailMovedMail(params: {
  locale: Locale;
  siteName: string;
  title: string;
  newEmail: string;
}): MailComposition {
  const { locale, siteName, title, newEmail } = params;
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const vars = { site: siteName, title, newEmail };
  return {
    channel: "mail",
    subject: t("mail.ownerEmailMovedSubject", vars),
    content: {
      template: "notice.moved",
      locale,
      preheader: t("mail.ownerEmailMovedPreheader", vars),
      title: t("mail.ownerEmailMovedTitle"),
      blocks: [
        { kind: "paragraph", text: t("mail.ownerEmailMovedWhat", vars) },
        { kind: "paragraph", text: t("mail.ownerEmailMovedRevoked", vars) },
      ],
      why: t("mail.identityFooter", vars),
    },
  };
}

/**
 * `code.identity.mail`, `code.journal.mail` and `code.ownerEmail.mail`'s
 * compositions — B2493. Their send sites are route handlers
 * (`app/api/auth/codes/route.ts`, `app/api/v2/[user]/route.ts`), which
 * cannot export anything but HTTP methods, so the pure half lives here
 * instead and each route imports it. Every one of these composers takes its
 * link, if any, already built (`identitySignInUrl`/`signInUrl`) — no
 * `isEnabled` or capability check happens in here.
 */

/** `code.identity.mail` — proves an address to the whole instance, names no
 * journal. Mirrors `handleIdentity` in `app/api/auth/codes/route.ts`. */
export function composeIdentityCodeMail(params: {
  locale: Locale;
  code: string;
  site: string;
  link?: string | null;
}): MailComposition {
  const { locale, code, site, link = null } = params;
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const vars = { site, code, minutes: CODE_TTL_MINUTES };
  const purpose: MailBlock[] = [
    { kind: "paragraph", text: t("mail.identityWhat") },
    { kind: "paragraph", text: t("mail.identityLasts") },
    ...(link ? ([{ kind: "paragraph", text: t("mail.identityApp", vars) }] as const) : []),
  ];
  return composeCodeMailContent({
    template: "code.identity.mail",
    locale,
    code,
    place: site,
    title: t("mail.identityTitle"),
    purpose,
    url: link ?? undefined,
    buttonText: link ? t("mail.identityButton") : undefined,
    ignoreText: t("mail.identityIgnore"),
    why: t("mail.identityFooter", vars),
  });
}

/**
 * `code.journal.mail`'s two doors — a reader's sign-in code (`for: "read"`)
 * and an agent's write token (`for: "write"`) — B2493. Mirrors
 * `handleJournal` in `app/api/auth/codes/route.ts` exactly, including its
 * one oddity: the "asked for at HH:MM" line is on for both doors. `link` and
 * `scopedTripTitle` are already resolved by the caller (`signInUrl`,
 * `getTrip`) — no auth/capability lookup happens in here.
 */
export function composeJournalCodeMail(params: {
  locale: Locale;
  code: string;
  siteName: string;
  title: string;
  for: "read" | "write";
  link?: string | null;
  scopedTripTitle?: string | null;
  askedAt: string;
}): MailComposition {
  const { locale, code, siteName, title, for: credFor, link = null, scopedTripTitle = null, askedAt } = params;
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const vars = { site: siteName, title, code, minutes: CODE_TTL_MINUTES };
  const isWrite = credFor === "write";
  const purpose = isWrite
    ? scopedTripTitle
      ? t("mail.agentScoped", { ...vars, trip: scopedTripTitle })
      : t("mail.agentAll")
    : link
      ? t("mail.signinTap", vars)
      : t("mail.identityCode", vars);
  const url = isWrite ? undefined : link ?? undefined;
  return composeCodeMailContent({
    template: "code.journal.mail",
    locale,
    code,
    place: title,
    title: isWrite ? t("mail.agentTitle") : t("mail.signinSubject", vars),
    purpose,
    url,
    buttonText: url ? t("mail.signinOpen", vars) : undefined,
    askedAt: t("mail.codeAsked", { when: askedAt }),
    ignoreText: t("mail.signinIgnore"),
    why: t("mail.identityFooter", vars),
  });
}

/** `code.ownerEmail.mail` — proving a new `owner.email` before it is
 * written. Mirrors `startOwnerEmailVerification` in
 * `app/api/v2/[user]/route.ts`. */
export function composeOwnerEmailCodeMail(params: {
  locale: Locale;
  code: string;
  siteName: string;
  title: string;
}): MailComposition {
  const { locale, code, siteName, title } = params;
  const t = (key: Parameters<typeof translateIn>[1], vars?: Record<string, string>) => translateIn(locale, key, vars);
  const vars = { site: siteName, title, code, minutes: CODE_TTL_MINUTES };
  return composeCodeMailContent({
    template: "code.ownerEmail.mail",
    locale,
    code,
    place: title,
    title: t("mail.ownerEmailCodeTitle"),
    purpose: t("mail.ownerEmailCodeWhat", vars),
    ignoreText: t("mail.ownerEmailCodeIgnore"),
    why: t("mail.identityFooter", vars),
  });
}
