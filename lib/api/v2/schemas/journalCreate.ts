// POST /api/v2/journals — B1624, phase 2 step 4.
//
// Deliberately its own file, and its own (smaller) shape, rather than a
// variant of `journalWrite` (./journal.ts): this is the one call in the v2
// vocabulary made by somebody who does not yet own a journal, so `owner` is
// two flat fields (name, nickname) rather than the nested object `journalWrite`
// echoes back, and `visibility` still accepts the pre-B306 "private" spelling
// a caller may reasonably send once, on the way in, the same tolerance
// `normalizeJournalVisibility` gives every other door. See
// docs/plans/2026-09-12-api-v2/content.md §10 for the "narrower create-time
// shape" reasoning this follows.
//
// Every field below is checked in `superRefine` rather than through zod's own
// `enum`/`length` machinery: this call is the first thing a person's agent
// sends on their behalf, and a bare "Invalid enum value" teaches nothing —
// B263/B277/B839 are the record of what silence or a generic refusal cost
// here in v1, and the wording below is carried over rather than dropped for
// being verbose.
import { z } from "zod";
import { LOCALE_LABEL, MAINTAINED_LOCALES } from "../../../i18n";

const LOCALES = MAINTAINED_LOCALES as readonly string[];
const LOCALE_LIST = MAINTAINED_LOCALES.map((code) => `${LOCALE_LABEL[code]} ("${code}")`).join(", ");
const CURRENCY_RE = /^[A-Za-z]{3}$/;

const base = z.strictObject({
  username: z.string().trim().min(1),
  title: z.string().trim().min(1).max(200),
  ownerName: z.string().trim().min(1),
  /** Never derived from `ownerName` — see `journalWrite`'s own field. */
  ownerNickname: z.string().trim().min(1),
  tagline: z.string().trim().min(1).optional(),
  visibility: z.string().optional(),
  /** The owner's own language — sets the welcome mail's. */
  defaultLocale: z.string().optional(),
  /** Which of those a reader may switch the journal into. Must contain
   * `defaultLocale` — a journal whose own language is not on offer to its
   * readers is a config problem, not a preference. */
  locales: z.array(z.string()).optional(),
  /** Permanent — nothing this API ever writes may change it afterwards. */
  baseCurrency: z.string().optional(),
  displayCurrencies: z.array(z.string()).optional(),
  units: z.enum(["metric", "imperial"]).optional(),
});

export const journalCreate = base.superRefine((doc, ctx) => {
  if (doc.visibility === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["visibility"],
      message:
        "visibility is required — there is no default. \"public\" or \"guest\": whether this " +
        "server advertises the journal. Ask which they want.",
    });
  } else if (!["public", "guest", "private"].includes(doc.visibility)) {
    ctx.addIssue({
      code: "custom",
      path: ["visibility"],
      message:
        `visibility must be "public" or "guest", got ${JSON.stringify(doc.visibility)}. It is ` +
        "also this journal's own answer for a new trip's default, unless the create call says " +
        "otherwise.",
    });
  }

  if (doc.defaultLocale === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultLocale"],
      message:
        `defaultLocale is required — there is no default. The language the owner writes in, ` +
        `${LOCALE_LIST}. Sets the language of the site's own chrome and of the welcome mail.`,
    });
  } else if (!LOCALES.includes(doc.defaultLocale)) {
    ctx.addIssue({
      code: "custom",
      path: ["defaultLocale"],
      message:
        `defaultLocale must be one of ${LOCALE_LIST}, got ${JSON.stringify(doc.defaultLocale)}. ` +
        'Send the code, not the language\'s name — "Deutsch" and "German" are both "de".',
    });
  }

  if (doc.locales === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["locales"],
      message:
        "locales is required — there is no default. Which languages a reader may switch the " +
        `journal into, as distinct from defaultLocale. Each entry one of ${LOCALE_LIST}.`,
    });
  } else {
    const bad = doc.locales.find((code) => !LOCALES.includes(code));
    if (bad !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["locales"],
        message: `locales has ${JSON.stringify(bad)}; each entry must be one of ${LOCALE_LIST}.`,
      });
    } else if (doc.defaultLocale !== undefined && !doc.locales.includes(doc.defaultLocale)) {
      ctx.addIssue({
        code: "custom",
        path: ["locales"],
        message: `locales must contain defaultLocale (${JSON.stringify(doc.defaultLocale)}).`,
      });
    }
  }

  if (doc.baseCurrency === undefined) {
    ctx.addIssue({
      code: "custom",
      path: ["baseCurrency"],
      message:
        "baseCurrency is required — there is no default, and this is the only field here that " +
        "can never be changed. Every cost anywhere in the journal is added up in it.",
    });
  } else if (!CURRENCY_RE.test(doc.baseCurrency)) {
    ctx.addIssue({
      code: "custom",
      path: ["baseCurrency"],
      message: `baseCurrency must be a three-letter currency code, got ${JSON.stringify(doc.baseCurrency)}.`,
    });
  } else if (
    doc.displayCurrencies &&
    !doc.displayCurrencies.some((c) => c.toUpperCase() === doc.baseCurrency!.toUpperCase())
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["displayCurrencies"],
      message: `displayCurrencies must include baseCurrency (${doc.baseCurrency}).`,
    });
  }
});

export type JournalCreate = z.infer<typeof base> & {
  visibility: string;
  defaultLocale: string;
  locales: string[];
  baseCurrency: string;
};
