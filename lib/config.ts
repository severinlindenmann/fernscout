import fs from "node:fs";
import path from "node:path";
import { isEmail } from "./auth";
import { contentRoot } from "./contentRoot";
import { siteRoot } from "./siteRoot";
import { normalizeCurrency, type RateTable } from "./currency";
import {
  DEFAULT_MEDIA_LIMITS,
  narrowest,
  parseMediaLimits,
  type MediaLimits,
} from "./mediaLimits";
import { parseTravellers } from "./travellers/parse";
import { toE164 } from "./whatsapp/phone";
import type { Figure } from "./travellers/vocabulary";

/** Every optional capability. Adding one here is the only place it gets named. */
export const FEATURE_NAMES = [
  "reactions",
  "costs",
  "push",
  "mail",
  "whatsapp",
  // B1057. Deliberately separate from `whatsapp` above, which means
  // "send day announcements to readers" — the conversational channel is a
  // different capability with a different cost and a different consent
  // story, and a journal may want one without the other. Conflating the two
  // would mean turning off announcements silently kills somebody's writing
  // door.
  "whatsappInbound",
  // B1316. The instance's own SMS number. Like whatsapp/whatsappInbound the
  // two directions are separate switches: sending spends the operator's
  // money per message, receiving is a webhook with its own credential.
  "sms",
  "smsInbound",
  "auth",
  "signup",
  "contacts",
  "postcards",
  "photobook",
  "logging",
  "credits",
  "addressLookup",
  "weather",
  "analytics",
  "helper",
  "transcription",
  "fulfilmentRelay",
  "fulfilmentAccept",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * The capabilities that are never a journal's own opt-in — decided once, by
 * the operator, for the whole instance. Every reader of a journal's `features`
 * has to skip the raw per-journal flag for exactly these and ask
 * `resolveCapabilities()` instead; exported so that skip is written once
 * rather than as a repeated `name === "logging" || name === "credits"`. See
 * `journalFeatures()` in lib/journals.ts, which is the one place that builds
 * the map itself — B408, B607.
 *
 * `logging` (B257) and `credits` (B366) were the first two, and are not
 * per-journal *questions* at all. **`photobook` and `postcards` join them in
 * B611**, which is a stronger claim: they are questions, they were asked of
 * the journal, and asking was wrong. They spend the operator's money at a
 * printer, so a journal has nothing to consent to — and the cost of asking was
 * that a journal which had never written the word had no photobook button and
 * no postcard proposal, with nothing on the page to say why. That was every
 * journal on this instance; the demo was the only one that worked, because
 * somebody had edited its file by hand. `resolveOne` skips the per-user check
 * for these, and `setJournalFeatures` refuses to write any of the four.
 */
export const OPERATOR_ONLY_FEATURES = [
  "logging",
  "credits",
  "photobook",
  "postcards",
  // B684. The same claim the two printing capabilities make, one supplier
  // along: the helper spends the operator's model key, so a journal has
  // nothing to consent to *here*. What it does consent to — words leaving the
  // machine at all — is `lib/helper/consent.ts`, which is a person reading a
  // panel rather than a flag in a file nobody sees.
  "helper",
  // B686. Speech is the same claim again, one supplier further along: the
  // transcriber spends the operator's key, so a journal has nothing to
  // consent to *here*. What it does consent to — its owner's own voice
  // leaving the machine — is the `speech` scope in lib/helper/consent.ts,
  // which is a person reading a panel rather than a flag in a file.
  "transcription",
  // B1316. Both spend the operator's money on the operator's own number, and
  // the inbox is the operator's page — a journal has nothing to consent to.
  "sms",
  "smsInbound",
  // B589. Both halves of the fulfilment relay (see
  // docs/plans/2026-09-06-fulfilment-relay.md) spend something that belongs
  // to the operator and not to a journal: `relay` names another instance to
  // hand a job to, and `accept` spends this instance's own printer account
  // and payment method on somebody else's order. Neither is a journal's to
  // switch on.
  "fulfilmentRelay",
  "fulfilmentAccept",
  // B1092. The opposite reason from the rest of this list, and worth reading
  // carefully because of it: `costs` spends nothing, reaches no supplier and
  // reveals nothing to anybody a trip does not already admit, so there is no
  // operator money to protect and no journal-level question to ask either.
  // It ended up per-journal anyway, which meant a journal that had never
  // written the word rendered no budget and said nothing about why — exactly
  // the B611 failure mode, for a capability that had no vote to cast in the
  // first place.
  "costs",
] as const satisfies readonly FeatureName[];

/**
 * Whose journal this is.
 *
 * One person, not a list. The list this replaces was journal-wide and
 * display-only, which meant every trip in a journal was credited to the same
 * people whether or not they were on it; who was actually on a trip is that
 * trip's `people:` block, and `lib/site.ts` builds the byline from both.
 *
 * `email` is optional and absent means read-only: it is the only address that
 * can obtain a write token for the journal (decision 24), so a journal that
 * declares no owner cannot be written to by anyone. That is the safe state,
 * and the state a freshly cloned repository is in.
 */
type Owner = {
  name: string;
  nickname: string;
  email?: string;
  /**
   * The owner's own telephone number, for their own free WhatsApp copy of a
   * published day — B614.
   *
   * Stored as E.164 digits, never as it was typed: `toE164` runs here at
   * parse time and the file's own form is not kept. Two reasons, and the
   * second is the one that matters — the send path
   * (`lib/digest/dayWhatsapp.ts`) needs digits and should not be re-parsing a
   * config string per message, and a number that will not normalise has to be
   * a *config* problem, reported once with the others, rather than a message
   * that silently never arrives.
   *
   * Normalised with **no** default country code, unlike a contact's number.
   * `whatsappCountryCode()` is the operator's env, and a journal that parsed
   * yesterday must not stop parsing because the operator edited it — so the
   * owner's own number carries its own country (`+41…`, `0041…` or a bare
   * `41…`), and a national `079…` is refused with a sentence saying why.
   */
  tel?: string;
  /**
   * When and how `tel` was proven to belong to this owner — B1064.
   *
   * A destination becomes an identity the moment something is checked against
   * it (B1058's webhook compares an inbound E.164 against this field), so the
   * proof has to travel with the number rather than live beside it in a
   * separate table nothing here reads. Absent means unproven: every `tel`
   * written before B1065 shipped, and any written since by the operator's own
   * hand rather than through the SMS flow. `lib/journals.ts`'s registry is
   * the lock that stops two journals claiming the same proven number; this is
   * the record of *that* journal having proven it.
   */
  telProvenAt?: string;
  /** `"sms"` for a signup passcode (any code backend — Twilio, WhatsApp
   * template, dry-run); `"whatsapp-inbound"` for a number proven by
   * messaging us (B1234); `"operator"` for a number an operator typed in by
   * hand, per B1064's decision that a number change is done by the
   * operator, by hand, until there is a self-serve path. */
  telProvenMethod?: "sms" | "operator" | "whatsapp-inbound";
};

/**
 * One person's settings, from `content/<username>/config.json`.
 *
 * Everything here belongs to the person, not to whoever runs the server. That
 * split is what lets one instance carry several unrelated travel blogs without
 * them sharing a voice, a language or a currency.
 */
/**
 * Whether a journal is advertised at all.
 *
 * `public` is a journal anyone may come across: it is on the instance's
 * `documentation.txt`, on the landing page, and in `sitemap.xml`. `guest` is a
 * journal you have to be sent the address of — off all three, and `noindex`.
 *
 * It used to be called `private`, and that is exactly what B306 is about: the
 * trip level already had a `private` with a stronger, narrower meaning —
 * "only the people who were there" — and reusing the word one level up for
 * "not advertised" meant an owner asked which their journal should be heard
 * `guest`, twice, before an agent worked out the two questions were different.
 * `guest` is also the more honest name for what the value actually does now:
 * it is this journal's answer for its trips' own default, the same way a
 * `guest` trip means "the people let into the journal" (see `lib/tripWrite.ts`).
 *
 * `private` is still read, forever, wherever this is parsed from a file or a
 * request — every journal already on disk may say it, and there is no
 * migration that rewrites somebody's `config.json` out from under them — but
 * nothing here ever writes it back out. See `normalizeJournalVisibility`.
 *
 * It is deliberately **not** an authentication wall in front of `/<user>`.
 * Whether a stranger with the URL can read a *journey* is the trip's own
 * `visibility` — `guest` for the people let into the journal, `private` for
 * only the people who were there; putting a second, weaker gate above it would be a
 * privacy control that looks stronger than the one doing the work. What
 * `guest` does change is the default a trip created in this journal gets, so
 * an agent that omits `visibility` cannot put a journey on the open web.
 *
 * Absent means `public`, which is what every journal written before W38 is.
 */
export type JournalVisibility = "public" | "guest";

/**
 * The one place a raw `visibility` value — off a request body or a
 * `config.json` — becomes one of the two states this level actually has.
 *
 * `"private"` is accepted here and nowhere writes it: every caller that reads
 * this level's visibility, from `lib/config.ts`'s own parser to the create and
 * patch routes, goes through this function so the three cannot disagree about
 * what the old word still means (B306's own harm, arriving through a rename,
 * was exactly three copies of a rule agreeing on two of three cases).
 *
 * Returns `undefined` for anything else, including `undefined` itself —
 * deliberately: silence and a typo are different problems, and a caller that
 * treats them differently (the parser defaults silence to `public`; a POST
 * body refuses it) has to be able to tell them apart.
 */
export function normalizeJournalVisibility(
  raw: unknown,
): JournalVisibility | undefined {
  if (raw === "public" || raw === "guest") return raw;
  if (raw === "private") return "guest";
  return undefined;
}

export type UserConfig = {
  username: string;
  owner: Owner;
  title: string;
  tagline: string;
  /** See JournalVisibility. Defaults to "public". */
  visibility: JournalVisibility;
  startLocation: string;
  defaultLocale: string;
  locales: string[];
  baseCurrency: string;
  displayCurrencies: string[];
  /**
   * Rates for anything the ECB does not publish, and overrides for anything
   * it does. Same convention as the ECB table: units of the currency for one
   * euro, so `{ "VND": 30500 }` reads "1 EUR = 30 500 VND".
   */
  manualRates: RateTable;
  units: "metric" | "imperial";
  /** Opt-ins, bounded by what the server can actually provide. */
  features: Record<FeatureName, FeatureConfig>;
  /**
   * This journal's media allowance, already narrowed to the server's.
   *
   * A user may ask for less than the instance allows, never more: the person
   * paying for the disk decides its size. See lib/mediaLimits.ts.
   */
  media: MediaLimits;
  /**
   * The journal's default party — how its travellers are drawn when a trip
   * does not say for itself. See lib/travellers/.
   *
   * A trip's own `travellers:` block wins outright rather than merging: a trip
   * is who was on *it*, and that changes between trips in one journal. Empty
   * here and empty on the trip means one neutral figure.
   */
  travellers: Figure[];
};

/**
 * Deployment settings, from `site/config.json`. A user cannot change these.
 *
 * `features` here is a **ceiling**: it says what this server is able to offer,
 * because it is the server that holds the credentials. A user opts in to what
 * they want from that set, and can never switch on something the server cannot
 * do — which keeps "enabled but unconfigured" a server-side boot error.
 */
export type ServerConfig = {
  site: {
    name: string;
    url: string;
    /** Served at the bare URLs as well as at /<username>. */
    defaultUser?: string;
    /**
     * Where this instance's source lives, and who runs it.
     *
     * Both optional and both absent by default. They exist because the
     * landing page wanted a "made in … by …" line and a link to the source,
     * and neither could be written into a component: the whole promise of the
     * content folder is that somebody deletes it, drops in their own and has
     * their own site, which a hardcoded name breaks on their very first
     * visitor. `test/depersonalised.test.ts` fails the build over exactly
     * this.
     *
     * A fork sets its own. An instance that sets neither shows neither.
     */
    repository?: string;
    credit?: { name: string; url?: string; countryCode?: string };
    /**
     * A notice across the top of the landing page, for when the instance is
     * not yet what a visitor would assume it is — a beta, a migration, an
     * afternoon of downtime. `enabled: false` keeps the wording on disk, so
     * the next occasion is a one-word edit rather than a rewrite.
     *
     * The operator's own words, and still not a locale file: `text` is what
     * every reader gets, and `translations` is the operator's own wording in
     * whatever other languages they can write it in. An instance cannot add a
     * key to `site/locales/`, but it can write its own sentence twice — and a
     * beta notice in a language the reader does not read is a notice nobody
     * reads (B660).
     */
    banner?: {
      enabled: boolean;
      text: string;
      translations?: Record<string, string>;
    };
    /**
     * The instance admin who approves credit purchases while there is no
     * payment provider (B425). The accept link for every purchase is mailed
     * here and nowhere else — never to the buying journal's owner, because an
     * owner who could approve their own purchase would mint free credits. An
     * address, not a secret, so it lives here; absent means purchases record a
     * request that only the CLI (`npm run credits -- grant`) can then fulfil.
     */
    operatorEmail?: string;
  };
  users: { reserved: string[] };
  features: Record<FeatureName, FeatureConfig>;
  /** How much media this instance accepts. A ceiling — see lib/mediaLimits.ts. */
  media: MediaLimits;
  /**
   * What running this instance costs, for the operator's dashboard — B746.
   *
   * **Config rather than code, because these are prices and prices move.** A
   * provider re-rates a model, a server plan changes, a domain renews at a
   * different figure; none of that should be a deploy, and none of it is
   * anybody's secret. `FERNSCOUT_CONFIG` means the deployed instance's real
   * numbers never travel in the repository to somebody else's.
   *
   * Everything here is optional and everything defaults to zero. A fresh
   * clone that has priced nothing shows a dashboard of real usage against a
   * cost of nothing, which is honest — an invented default price would read
   * as a measurement.
   *
   * All money is in **rappen**, integer, the same rule `lib/credits/pricing.ts`
   * keeps: never a float for money.
   */
  costs: CostConfig;
};

/**
 * The price list `/admin` multiplies usage by — B746.
 *
 * Token prices are per **million** tokens, which is how every provider quotes
 * them; storing them per-token would be a fraction of a rappen and unwritable
 * as an integer. Keyed by the model string the `usage` rows actually carry, so
 * a model swapped next month re-prices nothing that came before it.
 */
export type CostConfig = {
  /** Per model id: cost per million input and output tokens, in rappen. */
  models: Record<string, { inputPerMillionRappen: number; outputPerMillionRappen: number }>;
  /**
   * Per **thousand minutes** of audio transcribed, in rappen.
   *
   * Not per minute, for the same reason tokens are priced per million: a
   * minute of Deepgram Nova-3 is about a third of a rappen, and an integer
   * field priced per minute could only hold zero or a number three times too
   * large. The unit is the smallest one whose price is a whole rappen.
   */
  transcriptionPerThousandMinutesRappen: number;
  /** What is owed every month whether anybody writes a day or not — the
   *  server, and a domain divided down from its yearly price. Each is a
   *  label and a figure, so an operator adds a line without a code change. */
  fixedMonthly: { label: string; rappen: number }[];
  /**
   * Per outbound WhatsApp message, in rappen, keyed by Meta's template
   * category — `marketing`, `utility`, `authentication` (B1347). Meta
   * actually bills per *conversation*, so a per-send price is an
   * approximation the dashboard says out loud; it is still a measured count
   * times an operator's figure rather than a guess. An absent category
   * renders as "not priced". `service` replies are free by Meta's own
   * 24-hour-window rule and are never priced.
   */
  whatsappPerMessageRappen: Record<string, number>;
};

type FeatureConfig = {
  enabled: boolean;
  /** Feature-specific settings — `transport`, `provider`, and so on. */
  [key: string]: unknown;
};

/**
 * A config problem, carrying every error found rather than only the first.
 *
 * Someone cloning this repo will get their config wrong on the first try. One
 * message per run means one round trip per mistake, so we collect them all.
 */
export class ConfigError extends Error {
  readonly problems: string[];
  /**
   * Which file this is. Defaults to the server config for callers that
   * predate this parameter, but every caller in this module now passes its
   * own path — this class carries both `site/config.json` problems and
   * `content/<username>/config.json` ones, and a hardcoded filename in the
   * message named the wrong file for the second case.
   */
  constructor(problems: string[], file = "site/config.json") {
    super(`${file} is not usable:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const DEFAULT_FEATURES: Record<FeatureName, FeatureConfig> = {
  reactions: { enabled: true },
  costs: { enabled: true },
  push: { enabled: false },
  mail: { enabled: false, transport: "file" },
  // Announcements only, and off by default like every optional capability.
  // `dry-run` writes the payload it would have sent, so the whole feature
  // develops without a Meta account — see lib/whatsapp/index.ts.
  whatsapp: { enabled: false, backend: "dry-run" },
  // B1057. No backend option: unlike sending, reading has only one real
  // implementation — Meta's webhook — plus off. See lib/capabilities.ts for
  // what it needs (WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN).
  whatsappInbound: { enabled: false },
  // B1316. `dry-run` writes the payload under <dataDir>/sms/, so the whole
  // channel develops with no Twilio account. `allowedPrefixes` (e.g.
  // ["+41"]) names a sender restriction on the instance's number, so an
  // unreachable recipient is refused with a reason rather than silently
  // undelivered — see smsUnreachable in lib/sms.
  sms: { enabled: false, backend: "dry-run" },
  // B1316. Like whatsappInbound: reading has one real implementation —
  // Twilio's webhook — plus off. Needs TWILIO_AUTH_TOKEN (the signature
  // key); see lib/capabilities.ts.
  smsInbound: { enabled: false },
  auth: { enabled: false },
  // `phoneBackend` picks how `POST /api/auth/signup/phone/*` proves the
  // number a new journal is created with — B1065. `dry-run` writes the code
  // where a dry-run mail already goes, so the whole signup flow, phone step
  // included, develops with no provider account. See lib/phoneVerify/.
  signup: { enabled: false, phoneBackend: "dry-run" },
  contacts: { enabled: false },
  postcards: { enabled: false, provider: "dry-run" },
  photobook: { enabled: false, provider: "dry-run" },
  // One line per request to stdout — method, path, user agent, never an IP
  // or a query string. Server-only: there is deliberately no per-journal
  // opt-in (B257), so this is never narrowed by a user's own config.json —
  // see the exclusion in app/api/health/route.ts.
  logging: { enabled: false },
  // B366. Server-only, like `logging` above and for a sharper reason: this
  // decides whether a send is charged, and the money lands on the operator's
  // card rather than the journal's. A per-journal opt-in would mean nobody is
  // charged until they ask to be; a per-journal opt-out would let a journal
  // decline the bill for sends it still makes. So it is never asked with a
  // username — see `creditsEnabled()` in lib/credits.ts.
  //
  // Off means today's behaviour exactly — no debit, no refusal, no
  // panel — because a fresh clone of this repository starts every journal at
  // zero credits, and a clone that cannot send a single letter is a broken
  // checkout rather than a business model. The operator switches it on where
  // sends are actually being paid for.
  credits: { enabled: false },
  // B399. Off by default like every optional capability, and the one
  // provider that needs no key (`photon`, no signup at all) is the default —
  // AGENTS.md's rule that nothing here may require a paid account to
  // develop or test. `url` and `provider` are both overridable so an
  // instance that wants MapTiler or a self-hosted Photon can point at it
  // without a code change; any key that provider needs comes from
  // `ADDRESS_LOOKUP_API_KEY` (see lib/capabilities.ts), never from this file.
  addressLookup: {
    enabled: false,
    provider: "photon",
    url: "https://photon.komoot.io/api/",
  },
  // B325. Off by default like every optional capability, and — as with
  // `addressLookup` above — the provider it uses needs no key and no signup,
  // which is what makes it something a self-hoster can actually turn on. Off
  // means no request is made to open-meteo.com on any path, and no day shows
  // weather; not an empty box on every day.
  weather: { enabled: false },
  // B566. Off by default like every optional capability, and off means the
  // instance the imprint used to describe: no row is written, the page is not
  // there, and nothing about a reader is hashed, because the hash is only
  // computed on the recording path. A journal opts in for itself — unlike
  // `logging` and `credits`, which are the operator's alone, this is the
  // owner's question about their own readers, and the answer is theirs to
  // decline. Needs a database: these are rows, and a journal with no
  // DATABASE_URL gets no page rather than an empty one.
  analytics: { enabled: false },
  // B684. Off by default like every optional capability, and off means the
  // wizard exactly as B682 shipped it: the button to write a day up is simply
  // not there, and every other step still works with no model and no credits.
  // Needs `ANTHROPIC_API_KEY`, a database and `credits` — see
  // lib/capabilities.ts for why the last of those is a requirement rather
  // than a nicety.
  helper: { enabled: false },
  // B686. Off by default like every optional capability, and off means no
  // record button anywhere: the wizard and the ask box take typed words
  // exactly as they did before. `dry-run` is the backend a checkout without a
  // Deepgram account gets, and it returns a canned transcript rather than
  // failing — see lib/helper/transcribe.ts.
  transcription: { enabled: false, backend: "dry-run" },
  // B589. Off by default like every optional capability. `url` names the
  // fulfilment instance this one hands jobs to — read the same way
  // `addressLookup.url` is, above — and there is no sensible default the way
  // `photon` is one, since it names somebody else's server rather than a
  // public API; off means no job ever leaves this instance.
  fulfilmentRelay: { enabled: false, url: "" },
  // B589. Off by default. Needs no config value of its own: whether this
  // instance can actually fulfil a job is a question about `postcards` and
  // `photobook`'s own provider and about Stripe, both checked in
  // lib/capabilities.ts, not a separate setting here.
  fulfilmentAccept: { enabled: false },
};

/**
 * A journal's own defaults, which differ from the server's in exactly one
 * entry — and that difference is the whole of B60's second half.
 *
 * Every other capability is an **opt-in**: the user's flag says "I want this
 * on my journal", so absent means "I have not asked for it" and off is both
 * the safe and the obvious reading. The failure mode is a feature that does
 * not appear, which is visible and recoverable.
 *
 * `mail` is not that kind of switch. Since B60 a journal's `mail` means *do
 * not write to my readers* — a mute button, not a request for a feature. Read
 * absence as "no", and the failure mode inverts: letters that should go stop
 * going, silently, for every journal that has never mentioned mail. That is
 * every journal on disk today, because `scripts/migrate-users.ts` deliberately
 * files `mail` under the *server* config and never the user's; the per-journal
 * key exists at all only because one `parseFeatures` runs over both files.
 *
 * So absence here means **no opinion**, and it inherits the server's answer.
 * The three states are: absent → whatever the server says; `true` → the same
 * (a user can never widen past a server that has mail off); `false` → off.
 * Which is to say a journal's mail flag can only ever narrow, and now it only
 * narrows when somebody asked it to.
 *
 * `resolveCapabilities` needs no special case for any of this: it checks the
 * server first and returns early, so this table cannot widen anything.
 *
 * **`whatsapp` is the same kind of switch, and joins it in B611.** The
 * journal-level key is reached from one place an owner can actually see — the
 * channels panel on `/<user>/me`, B463 — and there it reads as *stop sending
 * my days to WhatsApp*, exactly like mail. Read absence as "no" and every
 * journal that has never named it is muted, which is the state every journal
 * on this instance was in: the operator had paid for the number, the server
 * said yes, and no contact was ever offered the channel. Absence is now no
 * opinion; a written `false` is still a mute.
 */
const USER_DEFAULT_FEATURES: Record<FeatureName, FeatureConfig> = {
  ...DEFAULT_FEATURES,
  mail: { ...DEFAULT_FEATURES.mail, enabled: true },
  whatsapp: { ...DEFAULT_FEATURES.whatsapp, enabled: true },
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function readString(
  src: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
  fallback?: string,
): string {
  const v = src[key];
  if (typeof v === "string" && v.trim() !== "") return v;
  if (v === undefined && fallback !== undefined) return fallback;
  const at = where ? `${where}.${key}` : key;
  problems.push(
    v === undefined
      ? `${at} is missing (expected a non-empty string)`
      : `${at} must be a non-empty string, got ${JSON.stringify(v)}`,
  );
  return fallback ?? "";
}

function readStringArray(
  src: Record<string, unknown>,
  key: string,
  where: string,
  problems: string[],
  fallback: string[],
): string[] {
  const v = src[key];
  if (v === undefined) return fallback;
  if (
    !Array.isArray(v) ||
    v.some((x) => typeof x !== "string" || x.trim() === "")
  ) {
    problems.push(
      `${where ? `${where}.` : ""}${key} must be an array of non-empty strings`,
    );
    return fallback;
  }
  if (v.length === 0) {
    problems.push(`${where ? `${where}.` : ""}${key} must not be empty`);
    return fallback;
  }
  return v as string[];
}

/**
 * `site.manualRates` — a currency-code → number map.
 *
 * Validated here rather than shrugged off the way trip rates are: a trip is
 * one page among many and must degrade rather than fail, but a typo in the
 * one file a cloner edits should be named on the way in.
 */
function readManualRates(
  src: Record<string, unknown>,
  problems: string[],
): Record<string, number> {
  const v = src.manualRates;
  if (v === undefined) return {};
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    problems.push('manualRates must be an object like { "VND": 30500 }');
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    const code = normalizeCurrency(key);
    if (!code) {
      problems.push(
        `manualRates has key "${key}", expected a three-letter currency code`,
      );
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      problems.push(
        `manualRates.${code} must be a positive number (units per 1 EUR), got ${JSON.stringify(value)}`,
      );
      continue;
    }
    out[code] = value;
  }
  return out;
}


function parseOwner(src: Record<string, unknown>, problems: string[]): Owner {
  // The shape before W37. Named explicitly rather than ignored: this file has
  // no configVersion gate, so an unrecognised key would otherwise be a journal
  // that silently loses its owner and becomes read-only.
  if (
    src.owner === undefined &&
    (src.travellers !== undefined || src.ownerEmail !== undefined)
  ) {
    problems.push(
      "travellers and ownerEmail were replaced by a single owner: " +
        '"owner": { "name": …, "nickname": …, "email": … }. ' +
        "Who was on a given trip now belongs in that trip's people: block. " +
        "See docs/config-upgrades.md.",
    );
    return { name: "", nickname: "" };
  }

  const raw = src.owner;
  if (
    !isRecord(raw) ||
    typeof raw.name !== "string" ||
    typeof raw.nickname !== "string"
  ) {
    problems.push("owner must be { name, nickname, email? }");
    return { name: "", nickname: "" };
  }

  const owner: Owner = { name: raw.name, nickname: raw.nickname };
  if (raw.tel !== undefined) {
    const tel = typeof raw.tel === "string" ? toE164(raw.tel) : null;
    if (!tel) {
      problems.push(
        "owner.tel must be a telephone number with its country code — +41 76 000 00 00, " +
          "0041 76 000 00 00 or 41760000000 — or absent. A national number like 076 000 00 00 " +
          "is refused here: this file is read on a server, which is not standing in any country.",
      );
    } else {
      owner.tel = tel;
    }
  }
  if (raw.telProvenAt !== undefined) {
    if (typeof raw.telProvenAt !== "string" || Number.isNaN(Date.parse(raw.telProvenAt))) {
      problems.push("owner.telProvenAt must be an ISO timestamp, or absent");
    } else {
      owner.telProvenAt = raw.telProvenAt;
    }
  }
  if (raw.telProvenMethod !== undefined) {
    if (raw.telProvenMethod !== "sms" && raw.telProvenMethod !== "operator" && raw.telProvenMethod !== "whatsapp-inbound") {
      problems.push('owner.telProvenMethod must be "sms", "operator" or "whatsapp-inbound", or absent');
    } else {
      owner.telProvenMethod = raw.telProvenMethod;
    }
  }
  if (raw.email !== undefined) {
    if (typeof raw.email !== "string" || !isEmail(raw.email.trim())) {
      problems.push("owner.email must be an email address, or absent");
    } else {
      owner.email = raw.email.trim().toLowerCase();
    }
  }
  return owner;
}

function parseUser(
  username: string,
  raw: unknown,
  problems: string[],
): UserConfig {
  const src = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) problems.push("the file must contain a JSON object");

  const locales = readStringArray(src, "locales", "", problems, ["en"]);
  const defaultLocale = readString(
    src,
    "defaultLocale",
    "",
    problems,
    locales[0],
  );
  if (locales.length > 0 && !locales.includes(defaultLocale)) {
    problems.push(
      `defaultLocale "${defaultLocale}" is not in locales [${locales.join(", ")}]`,
    );
  }

  const baseCurrency = readString(src, "baseCurrency", "", problems, "CHF");
  if (baseCurrency && !normalizeCurrency(baseCurrency)) {
    problems.push(
      `baseCurrency must be a three-letter currency code, got "${baseCurrency}"`,
    );
  }
  const displayCurrencies = readStringArray(
    src,
    "displayCurrencies",
    "",
    problems,
    [baseCurrency],
  );
  if (!displayCurrencies.includes(baseCurrency)) {
    problems.push(
      `displayCurrencies must include baseCurrency ("${baseCurrency}")`,
    );
  }
  for (const code of displayCurrencies) {
    if (!normalizeCurrency(code)) {
      problems.push(
        `displayCurrencies has "${code}", expected a three-letter currency code`,
      );
    }
  }

  const rawUnits = src.units;
  let units: UserConfig["units"] = "metric";
  if (rawUnits !== undefined) {
    if (rawUnits === "metric" || rawUnits === "imperial") units = rawUnits;
    else problems.push(`units must be "metric" or "imperial"`);
  }

  // Absent is `public`, because that is what every journal written before the
  // field existed is. `"private"` is the word this field used before B306 and
  // is accepted forever — see `normalizeJournalVisibility` — so a journal
  // nobody has touched since keeps meaning exactly what it always meant. A
  // value that is neither is a config problem — as `units` is — and a config
  // problem takes the journal off the site until it is fixed. The `guest`
  // fallback below is what the value would be if it ever were read anyway: a
  // misspelling must never be the thing that advertises somebody's journal.
  const rawVisibility = src.visibility;
  let visibility: JournalVisibility = "public";
  if (rawVisibility !== undefined) {
    const normalized = normalizeJournalVisibility(rawVisibility);
    if (normalized !== undefined) visibility = normalized;
    else {
      problems.push(
        `visibility must be "public" or "guest", got ${JSON.stringify(rawVisibility)}`,
      );
      visibility = "guest";
    }
  }

  return {
    username,
    owner: parseOwner(src, problems),
    title: readString(src, "title", "", problems),
    tagline: readString(src, "tagline", "", problems, ""),
    visibility,
    startLocation: readString(src, "startLocation", "", problems, ""),
    defaultLocale,
    locales,
    baseCurrency,
    displayCurrencies,
    manualRates: readManualRates(src, problems),
    units,
    features: parseFeatures(src.features, problems, USER_DEFAULT_FEATURES),
    media: parseMediaLimits(src.media),
    // Cosmetic, so it never adds to `problems`: a mistyped hair colour must
    // not be the thing that takes a journal off the site. `parseTravellers`
    // warns and falls back; see lib/travellers/parse.ts.
    travellers: parseTravellers(src.travellers, `${username}/config.json`),
  };
}

function parseFeatures(
  raw: unknown,
  problems: string[],
  /** Which table absence falls back to — see `USER_DEFAULT_FEATURES`. */
  defaults: Record<FeatureName, FeatureConfig> = DEFAULT_FEATURES,
): Record<FeatureName, FeatureConfig> {
  const out = {} as Record<FeatureName, FeatureConfig>;
  const src = isRecord(raw) ? raw : {};
  if (raw !== undefined && !isRecord(raw))
    problems.push("features must be an object");

  for (const name of FEATURE_NAMES) {
    const entry = src[name];
    if (entry === undefined) {
      out[name] = { ...defaults[name] };
      continue;
    }
    if (!isRecord(entry)) {
      problems.push(
        `features.${name} must be an object like { "enabled": false }`,
      );
      out[name] = { ...defaults[name] };
      continue;
    }
    if (typeof entry.enabled !== "boolean") {
      problems.push(`features.${name}.enabled must be true or false`);
    }
    // Stated wins over the default in both directions: this is the only place
    // a journal's `mail: { "enabled": false }` becomes an actual no.
    out[name] = {
      ...defaults[name],
      ...entry,
      enabled: entry.enabled === true,
    };
  }

  for (const key of Object.keys(src)) {
    if (!(FEATURE_NAMES as readonly string[]).includes(key)) {
      problems.push(
        `features.${key} is not a known feature (expected one of: ${FEATURE_NAMES.join(", ")})`,
      );
    }
  }
  return out;
}

/** Parse and validate a user's config. Exported for tests. */
export function parseUserConfig(username: string, raw: unknown): UserConfig {
  const problems: string[] = [];
  if (!isRecord(raw)) problems.push("the file must contain a JSON object");
  const config = parseUser(username, raw, problems);
  if (problems.length > 0)
    throw new ConfigError(problems, userConfigPath(username));
  return config;
}

/** Parse and validate the server's config. Exported for tests. */
export function parseServerConfig(raw: unknown): ServerConfig {
  const problems: string[] = [];
  const src = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) problems.push("the file must contain a JSON object");

  const site = isRecord(src.site) ? src.site : {};
  if (!isRecord(src.site))
    problems.push("site is missing (expected an object)");

  const users = isRecord(src.users) ? src.users : {};
  // May legitimately be empty: lib/users.ts carries its own always-reserved
  // list, so this one is additive rather than the whole defence.
  let reserved: string[] = [];
  if (users.reserved !== undefined) {
    if (
      !Array.isArray(users.reserved) ||
      users.reserved.some((x) => typeof x !== "string")
    ) {
      problems.push("users.reserved must be an array of strings");
    } else {
      reserved = users.reserved as string[];
    }
  }

  const defaultUserRaw = site.defaultUser;
  let defaultUser: string | undefined;
  if (defaultUserRaw !== undefined) {
    if (typeof defaultUserRaw !== "string" || defaultUserRaw.trim() === "") {
      problems.push("site.defaultUser must be a username, or absent");
    } else {
      defaultUser = defaultUserRaw;
    }
  }

  const config: ServerConfig = {
    site: {
      name: readString(site, "name", "site", problems, "Fernscout"),
      url: readString(site, "url", "site", problems, "http://localhost:3000"),
      defaultUser,
      repository: optionalUrl(site, "repository", "site.repository", problems),
      credit: parseCredit(site.credit, problems),
      banner: parseBanner(site.banner, problems),
      operatorEmail:
        typeof site.operatorEmail === "string" &&
        site.operatorEmail.trim() !== ""
          ? site.operatorEmail.trim()
          : undefined,
    },
    users: { reserved },
    features: parseFeatures(src.features, problems),
    media: parseMediaLimits(src.media),
    costs: parseCosts(src.costs, problems),
  };
  if (problems.length > 0) throw new ConfigError(problems, serverConfigPath());
  return config;
}

/** A whole, non-negative number of rappen, or a recorded problem. Money is
 *  never a float here, for the reason `lib/credits/pricing.ts` gives. */
function rappen(value: unknown, where: string, problems: string[]): number {
  if (value === undefined) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    problems.push(`${where} must be a whole number of rappen, zero or more`);
    return 0;
  }
  return value;
}

/**
 * The cost block — B746. Absent is normal and means "nothing has been priced",
 * which renders as a cost of zero rather than as a guess.
 */
function parseCosts(raw: unknown, problems: string[]): CostConfig {
  const empty: CostConfig = {
    models: {},
    transcriptionPerThousandMinutesRappen: 0,
    fixedMonthly: [],
    whatsappPerMessageRappen: {},
  };
  if (raw === undefined || raw === null) return empty;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("costs must be an object, or absent");
    return empty;
  }
  const src = raw as Record<string, unknown>;

  const models: CostConfig["models"] = {};
  const modelsRaw = src.models;
  if (modelsRaw !== undefined) {
    if (typeof modelsRaw !== "object" || modelsRaw === null || Array.isArray(modelsRaw)) {
      problems.push("costs.models must be an object keyed by model id, or absent");
    } else {
      for (const [id, entry] of Object.entries(modelsRaw as Record<string, unknown>)) {
        const row = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
        models[id] = {
          inputPerMillionRappen: rappen(row.inputPerMillionRappen, `costs.models.${id}.inputPerMillionRappen`, problems),
          outputPerMillionRappen: rappen(row.outputPerMillionRappen, `costs.models.${id}.outputPerMillionRappen`, problems),
        };
      }
    }
  }

  const fixedMonthly: CostConfig["fixedMonthly"] = [];
  const fixedRaw = src.fixedMonthly;
  if (fixedRaw !== undefined) {
    if (!Array.isArray(fixedRaw)) {
      problems.push("costs.fixedMonthly must be a list of { label, rappen }, or absent");
    } else {
      fixedRaw.forEach((entry, i) => {
        const row = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
        const label = typeof row.label === "string" ? row.label.trim() : "";
        if (label === "") {
          problems.push(`costs.fixedMonthly[${i}].label must be a name for the cost`);
          return;
        }
        fixedMonthly.push({ label, rappen: rappen(row.rappen, `costs.fixedMonthly[${i}].rappen`, problems) });
      });
    }
  }

  const whatsappPerMessageRappen: CostConfig["whatsappPerMessageRappen"] = {};
  const whatsappRaw = src.whatsappPerMessageRappen;
  if (whatsappRaw !== undefined) {
    if (typeof whatsappRaw !== "object" || whatsappRaw === null || Array.isArray(whatsappRaw)) {
      problems.push("costs.whatsappPerMessageRappen must be an object keyed by category, or absent");
    } else {
      for (const [category, value] of Object.entries(whatsappRaw as Record<string, unknown>)) {
        // The closed list lives in lib/whatsapp/sends.ts; refusing a typo
        // here beats a price that silently never matches a row.
        if (!["marketing", "utility", "authentication"].includes(category)) {
          problems.push(
            `costs.whatsappPerMessageRappen.${category} is not a Meta template category ` +
              `(marketing, utility, authentication — service is free by Meta's own rule)`,
          );
          continue;
        }
        whatsappPerMessageRappen[category] = rappen(
          value,
          `costs.whatsappPerMessageRappen.${category}`,
          problems,
        );
      }
    }
  }

  return {
    models,
    transcriptionPerThousandMinutesRappen: rappen(
      src.transcriptionPerThousandMinutesRappen,
      "costs.transcriptionPerThousandMinutesRappen",
      problems,
    ),
    fixedMonthly,
    whatsappPerMessageRappen,
  };
}

/**
 * The server's own config, which is not a journal and no longer lives among
 * them.
 *
 * Three places, most specific first. `FERNSCOUT_CONFIG` is what a deployed
 * instance sets, because its config is the operator's and must survive a
 * `git pull` — on this instance that is `$DATA_DIR/config.json`. A copy under
 * `CONTENT_DIR` is where this file lived before B510 and is still honoured, so
 * an instance that has not migrated keeps booting; it is also what every test
 * fixture writes. `site/config.json` in the checkout is the shipped default,
 * which is what a fresh clone runs on.
 */
export function serverConfigPath(): string {
  const configured = process.env.FERNSCOUT_CONFIG;
  if (configured && configured.trim() !== "") return configured;
  const legacy = path.join(contentRoot(), "config.json");
  return fs.existsSync(legacy) ? legacy : path.join(siteRoot(), "config.json");
}

/**
 * The landing-page notice, or nothing.
 *
 * Absent, switched off, and empty all mean the same thing to a reader, so all
 * three collapse to `undefined` here and callers ask one question rather than
 * three. A malformed block is a problem rather than a silent no: an operator
 * who wrote a notice meant it to be seen.
 */
function parseBanner(
  raw: unknown,
  problems: string[],
): ServerConfig["site"]["banner"] {
  if (raw === undefined) return undefined;
  if (
    !isRecord(raw) ||
    typeof raw.enabled !== "boolean" ||
    typeof raw.text !== "string" ||
    (raw.translations !== undefined &&
      (!isRecord(raw.translations) ||
        Object.values(raw.translations).some((v) => typeof v !== "string")))
  ) {
    problems.push(
      "site.banner must be { enabled: boolean, text: string, translations?: " +
        "{ [locale]: string } }, or absent",
    );
    return undefined;
  }
  if (!raw.enabled || raw.text.trim() === "") return undefined;
  const translations: Record<string, string> = {};
  for (const [locale, text] of Object.entries(raw.translations ?? {})) {
    const trimmed = (text as string).trim();
    // An empty translation is the operator not having written one yet, which
    // is what `text` is for. Keeping it would serve a blank banner.
    if (trimmed !== "") translations[locale] = trimmed;
  }
  return {
    enabled: true,
    text: raw.text.trim(),
    ...(Object.keys(translations).length > 0 ? { translations } : {}),
  };
}

/**
 * An optional `https://` field, or nothing.
 *
 * Rejected rather than ignored when it is present and wrong: a footer link
 * that goes nowhere is worse than no footer link, and a `javascript:` in a
 * config file should never reach an `href`.
 */
function optionalUrl(
  src: Record<string, unknown>,
  key: string,
  path: string,
  problems: string[],
): string | undefined {
  const raw = src[key];
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string" || !/^https?:\/\//.test(raw.trim())) {
    // Named by its full path. `site.credit.url` and `site.url` are different
    // lines of the same file, and a message that says the wrong one sends
    // somebody to look at a field that is fine.
    problems.push(`${path} must be an http(s) URL, or absent`);
    return undefined;
  }
  return raw.trim();
}

/** Who to credit at the foot of the landing page. Absent is the default. */
function parseCredit(
  raw: unknown,
  problems: string[],
): { name: string; url?: string; countryCode?: string } | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    problems.push("site.credit must be an object, or absent");
    return undefined;
  }
  const src = raw as Record<string, unknown>;
  const name = typeof src.name === "string" ? src.name.trim() : "";
  if (name === "") {
    problems.push("site.credit.name is required when site.credit is present");
    return undefined;
  }
  const countryCode =
    typeof src.countryCode === "string" &&
    /^[A-Za-z]{2}$/.test(src.countryCode.trim())
      ? src.countryCode.trim().toUpperCase()
      : undefined;
  if (src.countryCode !== undefined && !countryCode) {
    problems.push(
      "site.credit.countryCode must be a two-letter code, or absent",
    );
  }
  return {
    name,
    url: optionalUrl(src, "url", "site.credit.url", problems),
    countryCode,
  };
}

export function userConfigPath(username: string): string {
  return path.join(contentRoot(), username, "config.json");
}

/** Keyed by absolute path, so a test pointing CONTENT_DIR elsewhere doesn't get
 * handed the previous directory's config. Mirrors lib/trips.ts.
 *
 * Held against the file's own `mtime:size` rather than until somebody calls
 * `clearConfigCache()`, for the reason `getUsernames()` sets out at length: a
 * production build hands the pages and the route handlers separate instances
 * of this module, so an explicit invalidation only ever clears one of them.
 * Editing a journal's config.json also used to need a restart, which is a poor
 * answer for a file the owner is invited to edit by hand. */
type Cached<T> = { signature: string; value: T };
const serverCache = new Map<string, Cached<ServerConfig>>();
const userCache = new Map<string, Cached<UserConfig>>();

/** `mtime:size`, or "-" when the file cannot be stat'd — in which case the read
 * below fails too and reports it properly. Never a constant: two different
 * missing files must not share a cache entry. */
function fileSignature(file: string): string {
  try {
    const { mtimeMs, size } = fs.statSync(file);
    return `${mtimeMs}:${size}`;
  } catch {
    return "-";
  }
}

function readJson(file: string, hint: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new ConfigError([`could not be read. ${hint}`], file);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      [`is not valid JSON: ${(err as Error).message}`],
      file,
    );
  }
}

export function loadServerConfig(): ServerConfig {
  const file = serverConfigPath();
  const signature = fileSignature(file);
  const cached = serverCache.get(file);
  if (cached && cached.signature === signature) return cached.value;
  const config = parseServerConfig(
    readJson(file, "Copy content/example/../config.json to get started."),
  );
  serverCache.set(file, { signature, value: config });
  return config;
}

export function loadUserConfig(username: string): UserConfig {
  const file = userConfigPath(username);
  // The server's file is in the signature too: the media block below is
  // narrowed against the instance ceiling, so a user config that has not
  // changed still parses to something different when the server's has.
  const signature = `${fileSignature(file)}/${fileSignature(serverConfigPath())}`;
  const cached = userCache.get(file);
  if (cached && cached.signature === signature) return cached.value;
  const raw = readJson(
    file,
    `Every user needs a config.json — see content/example/config.json.`,
  );
  const parsed = parseUserConfig(username, raw);
  // Narrowed here rather than at parse time: the ceiling belongs to the
  // server, and a user config parsed on its own has no way to see it. Asking
  // for more than the instance allows is not an error — it is a preference the
  // instance cannot honour, and the instance's number wins.
  // Re-read against the instance's own numbers rather than against the
  // shipped defaults — B661. `parseUserConfig` cannot see the ceiling (see its
  // note), so a field this journal says nothing about came back as the
  // *default*, and `narrowest` then took the smaller of the default and the
  // instance's. That was invisible while every default was also the shipped
  // maximum; it stopped being invisible when `perUserBytes` gained one, since
  // an operator who had switched the ceiling off entirely still got the 5 GB
  // default imposed on every journal that had never mentioned storage.
  // Absent now means "whatever the instance says", which is what it reads as.
  const ceiling = serverMediaCeiling();
  const config: UserConfig = {
    ...parsed,
    media: narrowest(
      ceiling,
      parseMediaLimits((raw as { media?: unknown } | null)?.media, ceiling),
    ),
  };
  userCache.set(file, { signature, value: config });
  return config;
}

/**
 * The instance's media ceiling, or the shipped defaults.
 *
 * Deliberately tolerant of a missing server config. Reading one journal must
 * not require the whole instance to be present: `npm run export` produces a
 * folder that is exactly one user, and restoring it somewhere to read it back
 * is a supported thing to do — a test does precisely that. A journal with no
 * instance around it gets the defaults rather than an exception.
 */
export function serverMediaCeiling(): MediaLimits {
  try {
    return loadServerConfig().media;
  } catch {
    return DEFAULT_MEDIA_LIMITS;
  }
}

/** Test seam — drops every memoised config. */
export function clearConfigCache(): void {
  serverCache.clear();
  userCache.clear();
}
