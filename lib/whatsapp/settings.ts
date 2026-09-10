import { loadServerConfig } from "../config";

/**
 * The country code a national telephone number is assumed to belong to.
 *
 * Configured, never inferred — `lib/whatsapp/phone.ts` says at length why
 * guessing it is the one mistake in this module that hurts a stranger rather
 * than the operator. Absent means national numbers are simply not messageable,
 * which is the outcome that cannot send a family photograph to the wrong
 * person.
 *
 * Server-level rather than per-journal: it is a statement about where the
 * people filling in this instance's forms are standing, and an instance is
 * hosted once.
 */
export function whatsappCountryCode(): string | undefined {
  const configured = loadServerConfig().features.whatsapp.defaultCountryCode;
  return typeof configured === "string" && configured.trim() !== "" ? configured : undefined;
}

/**
 * This instance's own number, for a `wa.me` link — B1127.
 *
 * `features.whatsapp.number` in `site/config.json`, E.164 digits, no `+` —
 * the same shape `toE164` produces and `wa.me/<number>` wants. Absent means
 * the link simply is not rendered anywhere, which is the outcome the owner
 * chose over a broken chip: nothing here guesses a number from the Cloud API
 * credentials, because the phone number id `WHATSAPP_PHONE_NUMBER_ID` names
 * is not the dialable number itself.
 */
export function whatsappDisplayNumber(): string | undefined {
  const configured = loadServerConfig().features.whatsapp.number;
  return typeof configured === "string" && configured.trim() !== "" ? configured.trim() : undefined;
}

/**
 * Which approved template announces a day in a given language.
 *
 * `features.whatsapp.templates` maps a locale to a template name, because
 * Meta treats a template's language as part of its identity: `de` and `en`
 * are two separate assets, each approved on its own. A locale nobody has a
 * template for falls back to the journal's own, rather than failing — a
 * French-speaking reader getting the German announcement is a smaller harm
 * than getting nothing, and the alternative is that adding a locale silently
 * stops the whole feature.
 *
 * ## Why the *name* is configuration and not a constant
 *
 * Because you will change the wording, and changing the wording means a new
 * template. Meta does not let an approved one be edited freely, and — this is
 * the part that cost a day here — **a deleted template's name is reserved for
 * 30 days.** Deleting `fernscout_day_published` to recreate it without a
 * footer produced `(#100/2388023)` on every attempt to create it again, with
 * no way to undo and no way to use the name until October. The recovery was
 * `fernscout_day_published_v2` and one line in `site/config.json`, which is
 * only cheap because the name lives there rather than in this file.
 *
 * So: **never delete a template to fix it. Create the next version under a
 * new name and repoint the config.** The old one costs nothing to leave
 * sitting there, and it keeps working until the new one is approved, which
 * means the wording can change with no window where announcements fail.
 */
export type WhatsappTemplateSetting = { name: string; language: string; manageLink: boolean };

/**
 * A configured template entry: a bare name (the original shape, B365), or
 * `{ name, manageLink: true }` once an approved template has a fourth body
 * variable for the self-serve manage link — B386.
 *
 * A journal cannot merely start sending a fourth `{{4}}` because the code
 * changed; Meta rejects a body whose parameter count does not match what was
 * approved. So `manageLink` stays `false` (the field's absence, for every
 * template configured before this) until a person with access to the Meta
 * Business Manager has approved a new template *version* carrying the extra
 * variable and repointed this entry at its name — see `docs/tasks/` B386 for
 * exactly what to author. Flipping this on for a template that still has
 * three variables makes every send in that language fail.
 */
function entryFor(value: unknown): { name: string; manageLink: boolean } | null {
  if (typeof value === "string" && value.trim() !== "") return { name: value, manageLink: false };
  if (typeof value === "object" && value !== null) {
    const name = (value as Record<string, unknown>).name;
    const manageLink = (value as Record<string, unknown>).manageLink === true;
    if (typeof name === "string" && name.trim() !== "") return { name, manageLink };
  }
  return null;
}

export function templateFor(locale: string, fallbackLocale: string): WhatsappTemplateSetting | null {
  const configured = loadServerConfig().features.whatsapp.templates;
  if (typeof configured !== "object" || configured === null) return null;
  const table = configured as Record<string, unknown>;

  const exact = entryFor(table[locale]);
  if (exact) return { name: exact.name, language: locale, manageLink: exact.manageLink };
  const fallback = entryFor(table[fallbackLocale]);
  if (fallback) return { name: fallback.name, language: fallbackLocale, manageLink: fallback.manageLink };
  return null;
}

/**
 * The approved template an evening reminder sends — B1219, D46.
 *
 * A single `{name, language}` pair rather than `templateFor`'s per-locale
 * map: a reminder is one short nudge, and a journal without an approved
 * translation for its own default locale is exactly the case where mail —
 * the channel that needs no Meta approval at all — is the honest choice.
 * `features.whatsapp.reminderTemplate` in `site/config.json`, absent by
 * default, so a reminder can never be set to `whatsapp` on an instance
 * nobody has configured one for — `lib/api/tripReminder.ts` refuses the
 * write rather than accepting a channel that would never actually send.
 */
export function reminderTemplate(): { name: string; language: string } | null {
  const configured = loadServerConfig().features.whatsapp.reminderTemplate;
  if (typeof configured !== "object" || configured === null) return null;
  const { name, language } = configured as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof language !== "string" || language.trim() === "") return null;
  return { name: name.trim(), language: language.trim() };
}
