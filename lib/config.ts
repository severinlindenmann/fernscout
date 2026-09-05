import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { normalizeCurrency, type RateTable } from "./currency";
import { DEFAULT_MEDIA_LIMITS, narrowest, parseMediaLimits, type MediaLimits } from "./mediaLimits";

/** Every optional capability. Adding one here is the only place it gets named. */
export const FEATURE_NAMES = [
  "reactions",
  "costs",
  "push",
  "mail",
  "whatsapp",
  "auth",
  "signup",
  "contacts",
  "postcards",
  "photobook",
  "logging",
  "credits",
  "addressLookup",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

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
export type Owner = { name: string; nickname: string; email?: string };

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
export function normalizeJournalVisibility(raw: unknown): JournalVisibility | undefined {
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
};

/**
 * Deployment settings, from `content/config.json`. A user cannot change these.
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
};

export type FeatureConfig = {
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
   * own path — this class carries both `content/config.json` problems and
   * `content/<username>/config.json` ones, and a hardcoded filename in the
   * message named the wrong file for the second case.
   */
  constructor(problems: string[], file = "content/config.json") {
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
  auth: { enabled: false },
  signup: { enabled: false },
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
  addressLookup: { enabled: false, provider: "photon", url: "https://photon.komoot.io/api/" },
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
 */
const USER_DEFAULT_FEATURES: Record<FeatureName, FeatureConfig> = {
  ...DEFAULT_FEATURES,
  mail: { ...DEFAULT_FEATURES.mail, enabled: true },
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
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || x.trim() === "")) {
    problems.push(`${where ? `${where}.` : ""}${key} must be an array of non-empty strings`);
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
    problems.push("manualRates must be an object like { \"VND\": 30500 }");
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
    const code = normalizeCurrency(key);
    if (!code) {
      problems.push(`manualRates has key "${key}", expected a three-letter currency code`);
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseOwner(src: Record<string, unknown>, problems: string[]): Owner {
  // The shape before W37. Named explicitly rather than ignored: this file has
  // no configVersion gate, so an unrecognised key would otherwise be a journal
  // that silently loses its owner and becomes read-only.
  if (src.owner === undefined && (src.travellers !== undefined || src.ownerEmail !== undefined)) {
    problems.push(
      'travellers and ownerEmail were replaced by a single owner: ' +
        '"owner": { "name": …, "nickname": …, "email": … }. ' +
        "Who was on a given trip now belongs in that trip's people: block. " +
        "See docs/config-upgrades.md.",
    );
    return { name: "", nickname: "" };
  }

  const raw = src.owner;
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.nickname !== "string") {
    problems.push("owner must be { name, nickname, email? }");
    return { name: "", nickname: "" };
  }

  const owner: Owner = { name: raw.name, nickname: raw.nickname };
  if (raw.email !== undefined) {
    if (typeof raw.email !== "string" || !EMAIL_RE.test(raw.email.trim())) {
      problems.push("owner.email must be an email address, or absent");
    } else {
      owner.email = raw.email.trim().toLowerCase();
    }
  }
  return owner;
}

function parseUser(username: string, raw: unknown, problems: string[]): UserConfig {
  const src = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) problems.push("the file must contain a JSON object");

  const locales = readStringArray(src, "locales", "", problems, ["en"]);
  const defaultLocale = readString(src, "defaultLocale", "", problems, locales[0]);
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
  const displayCurrencies = readStringArray(src, "displayCurrencies", "", problems, [
    baseCurrency,
  ]);
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
      problems.push(`visibility must be "public" or "guest", got ${JSON.stringify(rawVisibility)}`);
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
  if (raw !== undefined && !isRecord(raw)) problems.push("features must be an object");

  for (const name of FEATURE_NAMES) {
    const entry = src[name];
    if (entry === undefined) {
      out[name] = { ...defaults[name] };
      continue;
    }
    if (!isRecord(entry)) {
      problems.push(`features.${name} must be an object like { "enabled": false }`);
      out[name] = { ...defaults[name] };
      continue;
    }
    if (typeof entry.enabled !== "boolean") {
      problems.push(`features.${name}.enabled must be true or false`);
    }
    // Stated wins over the default in both directions: this is the only place
    // a journal's `mail: { "enabled": false }` becomes an actual no.
    out[name] = { ...defaults[name], ...entry, enabled: entry.enabled === true };
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
  if (problems.length > 0) throw new ConfigError(problems, userConfigPath(username));
  return config;
}

/** Parse and validate the server's config. Exported for tests. */
export function parseServerConfig(raw: unknown): ServerConfig {
  const problems: string[] = [];
  const src = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) problems.push("the file must contain a JSON object");

  const site = isRecord(src.site) ? src.site : {};
  if (!isRecord(src.site)) problems.push("site is missing (expected an object)");

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
      operatorEmail:
        typeof site.operatorEmail === "string" && site.operatorEmail.trim() !== ""
          ? site.operatorEmail.trim()
          : undefined,
    },
    users: { reserved },
    features: parseFeatures(src.features, problems),
    media: parseMediaLimits(src.media),
  };
  if (problems.length > 0) throw new ConfigError(problems, serverConfigPath());
  return config;
}

export function serverConfigPath(): string {
  return path.join(contentRoot(), "config.json");
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
    typeof src.countryCode === "string" && /^[A-Za-z]{2}$/.test(src.countryCode.trim())
      ? src.countryCode.trim().toUpperCase()
      : undefined;
  if (src.countryCode !== undefined && !countryCode) {
    problems.push("site.credit.countryCode must be a two-letter code, or absent");
  }
  return { name, url: optionalUrl(src, "url", "site.credit.url", problems), countryCode };
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
    throw new ConfigError([`is not valid JSON: ${(err as Error).message}`], file);
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
  const parsed = parseUserConfig(
    username,
    readJson(file, `Every user needs a config.json — see content/example/config.json.`),
  );
  // Narrowed here rather than at parse time: the ceiling belongs to the
  // server, and a user config parsed on its own has no way to see it. Asking
  // for more than the instance allows is not an error — it is a preference the
  // instance cannot honour, and the instance's number wins.
  const config: UserConfig = {
    ...parsed,
    media: narrowest(serverMediaCeiling(), parsed.media),
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
function serverMediaCeiling(): MediaLimits {
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
