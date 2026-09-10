import { FEATURE_NAMES, OPERATOR_ONLY_FEATURES, loadServerConfig, type FeatureName } from "./config";
import { getUser } from "./users";
import { addressLookupEndpoints } from "./addressLookup";
import { stripeMode, stripeProblem } from "./stripe";

/**
 * What a capability needs before it can honestly claim to be on.
 *
 * `env` names are checked for presence only — a capability that needs a
 * *valid* credential still fails at first use, but "you enabled mail and never
 * set SMTP_HOST" is knowable at boot, and that is the failure worth catching.
 */
type Requirement = {
  env: readonly string[];
  db: boolean;
  /**
   * Capabilities that must be on before this one can be, and why in a few
   * words — the words `/api/health` prints, so write them for whoever has to
   * decide which switch to throw.
   *
   * A field rather than an `if` in the resolver — B724. `helper` was the first
   * capability to require another and was written as one `if`; `transcription`
   * arrived and made it two, which is the point at which the resolver becomes
   * a place dependencies hide. As data, a missing dependency is reported the
   * same way a missing environment variable is, from the same table a reader
   * of this file is already looking at.
   */
  needs?: Readonly<Partial<Record<FeatureName, string>>>;
};

const REQUIREMENTS: Record<FeatureName, Requirement> = {
  reactions: { env: [], db: false },
  costs: { env: [], db: false },
  push: { env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], db: false },
  mail: { env: [], db: false }, // transport-specific; see mailRequirements()
  // Backend-specific, the same way mail is: `dry-run` needs nothing, which
  // is what keeps this developable with no Meta account at all.
  whatsapp: { env: [], db: false },
  // B1057. A different switch from `whatsapp` above (see FEATURE_NAMES in
  // lib/config.ts for why) and a different credential shape — reading a
  // webhook needs the app secret and the handshake's verify token, neither
  // of which sending needs. No `db: true` here: idempotency (lib/idempotency.ts)
  // falls back to an in-memory store with no database, so this stays
  // developable with `dry-run`'s discipline — a fixture posted locally,
  // no Meta account, no database.
  whatsappInbound: { env: ["WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"], db: false },
  auth: { env: ["SESSION_SECRET"], db: true },
  // Self-service journal creation. Needs somewhere to keep the codes it
  // issues, and — checked in the route rather than here — mail to send them
  // with, since a signup nobody can complete is worse than one refused.
  signup: { env: ["SESSION_SECRET"], db: true },
  contacts: {
    env: ["CONTACTS_ENCRYPTION_KEY"],
    db: true,
    /**
     * **An approval that cannot grant anything is not an approval** — B938.
     *
     * Everything this capability does ends in somebody reading a journal they
     * were let into, and being let in is a session. Without `auth` there are
     * no sessions, so a guest grant is a row nothing consults and the mail
     * telling her she is in links to the gate she has just been let past.
     *
     * That mail is the only one she gets, so nothing corrects it later. She
     * was told yes, handed a door, and the door is locked — which is worse
     * than a contacts page that is simply not there.
     */
    needs: { auth: "being let in is a session, and sessions are what auth is" },
  },
  postcards: { env: [], db: true }, // provider-specific; see providerRequirements()
  // Orders are rows and so is the balance that pays for them, so a journal
  // with no database has no photobook button — /api/health says which.
  photobook: { env: [], db: true },
  logging: { env: [], db: false },
  // B366. The balance and its ledger are rows, so charging without a database
  // would be a number nobody could decrement — and `spend` refusing every
  // send is the safe reading of that, not a silent free-for-all.
  credits: { env: [], db: true },
  // B399. See configuredEnv() for the provider-specific half — `photon`
  // needs nothing, which is the whole point of defaulting to it.
  addressLookup: { env: [], db: false },
  // B325. Open-Meteo needs no key and nothing is stored in a database — the
  // reading goes into the day's own frontmatter, because weather that lives
  // only in a cache is weather that disappears when the cache does. So the
  // capability needs nothing, and off is a decision rather than a shortfall:
  // it means no request is made to a third party on any path.
  weather: { env: [], db: false },
  // B566. Rows in `analytics_events`, so a journal with no database gets no
  // page rather than one reporting zero — /api/health says which. No env: the
  // visitor salt is generated in memory and never configured, which is what
  // makes it un-persistable by construction rather than by policy.
  analytics: { env: [], db: true },
  // B684. The key is environment-only — it is a bearer credential that spends
  // the operator's money at a model provider, and `site/config.json` is a file
  // people commit. The database is `credits`' storage rather than the
  // helper's own: nothing here writes a row except the ledger, and a spend
  // nobody could record would be a free model call with no trace.
  helper: {
    env: ["ANTHROPIC_API_KEY"],
    db: true,
    // B684. `spend` with charging switched off succeeds without writing
    // anything, so a helper on top of a credits that is off is not a cheaper
    // helper — it is an unmetered one billed to the operator with no ledger to
    // find it in.
    needs: { credits: "every model call is metered" },
  },
  // B686. The key is environment-only for the same reason the helper's is,
  // and the database is again `credits`' storage rather than this
  // capability's own: a minute of somebody's voice is metered, and a spend
  // nobody could record would be an unmetered call billed to the operator.
  // Backend-specific env is in `configuredEnv` below, so `dry-run` needs
  // nothing at all.
  transcription: {
    env: [],
    db: true,
    // B686. The same argument: speech on top of a credits that is off is not
    // cheaper speech, it is unmetered speech billed to the operator.
    needs: { credits: "every minute is metered" },
  },
  // B589. Names a `url` in config, checked in configuredEnv() alongside the
  // other per-feature config problems, so an unset one refuses the same way
  // a missing environment variable does.
  fulfilmentRelay: { env: [], db: false },
  // B589. Nothing here fits `needs` — that only asks whether a dependency is
  // `.enabled`, and this depends on postcards/photobook being enabled *with a
  // real provider*, and on a payment method. See fulfilmentAcceptProblem().
  fulfilmentAccept: { env: [], db: false },
};

/** Transport and provider choices carry their own credential requirements.
 * `dry-run` and `file` need nothing, which is what makes local development
 * possible with no accounts anywhere. */
const TRANSPORT_ENV: Record<string, readonly string[]> = {
  file: [],
  console: [],
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"],
};

/**
 * What each WhatsApp backend needs before it can honestly claim to be on.
 *
 * The token is an environment variable and never `site/config.json`: it is
 * a bearer credential for an account that can message real people, and that
 * file is one people commit. `WHATSAPP_WABA_ID` is not here — nothing in the
 * send path uses it (it identifies the *account*, and messages are addressed
 * to a phone number id), so requiring it would be theatre.
 */
const WHATSAPP_BACKEND_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  cloud: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
};

/**
 * What each phone-verification backend needs — B1065. `dry-run` needs
 * nothing, which is what keeps the whole signup flow, phone step included,
 * developable with no provider account. See `lib/phoneVerify/`.
 */
const PHONE_VERIFY_BACKEND_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_VERIFY_SERVICE_SID"],
  // B1222. Needs no env of its own: the send rides `features.whatsapp`,
  // whose own backend names what it needs — the cross-capability check is in
  // the signup branch below.
  whatsapp: [],
  // B1234. The person messages us, so this needs the whole inbound half —
  // checked in the signup branch below, like `whatsapp` above.
  "whatsapp-inbound": [],
};

/**
 * What each transcription backend needs — B686. Beside `WHATSAPP_BACKEND_ENV`
 * rather than imported from `lib/helper/transcribe.ts`, which is
 * `server-only`: this module is read from places a `server-only` import would
 * poison, and a two-row table is cheaper than that risk. The names are the
 * ones `speechBackend()` dispatches on.
 */
const SPEECH_BACKEND_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  deepgram: ["DEEPGRAM_API_KEY"],
};

const PROVIDER_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  stannp: ["STANNP_API_KEY"],
  swisspost: ["SWISSPOST_USERNAME", "SWISSPOST_PASSWORD"],
  peecho: ["PEECHO_API_KEY"],
  gelato: ["GELATO_API_KEY"],
  cloudprinter: ["CLOUDPRINTER_API_KEY"],
  // Lulu is OAuth2 client credentials rather than a static key, so it needs a
  // pair. See docs/providers/photobook.md.
  lulu: ["LULU_CLIENT_KEY", "LULU_CLIENT_SECRET"],
};

/**
 * What each address lookup provider needs. Unlike `PROVIDER_ENV` above, this
 * is not the whole list of providers this capability can talk to — any URL
 * an operator points `features.addressLookup.url` at is fair game, since the
 * request is a plain query-string GET the same shape for all of them
 * (`lib/addressLookup.ts`). `photon` is named because it is the one that
 * needs no key at all; everything else is assumed to, since we cannot know
 * from a provider's name alone whether it does.
 */
const ADDRESS_LOOKUP_PROVIDER_ENV: Record<string, readonly string[]> = {
  photon: [],
};

export type CapabilityState =
  | { name: FeatureName; enabled: true; note?: string }
  | { name: FeatureName; enabled: false; reason: string };

/**
 * The one thing `enabled: true` does not otherwise say: a print capability
 * whose provider is `dry-run` is on, and will happily create orders and
 * "send" them, without a single card or book ever reaching a printer — B492.
 * That is correct behaviour for local development (AGENTS.md: no feature
 * needs a paid account to develop or test), and it is also exactly what a
 * self-hoster with no printer account sees when they turn the flag on,
 * without anything telling them the button is a rehearsal. `resolveOne`
 * attaches this note rather than flipping `enabled` to false, because the
 * capability genuinely is on — an agent can still propose an order and a
 * person can still press the button — it just does not fulfil anything yet.
 */
function dryRunNote(name: FeatureName, feature: Record<string, unknown>): string | undefined {
  if (name !== "postcards" && name !== "photobook") return undefined;
  const provider = optionOf(feature, "provider") ?? "dry-run";
  if (provider === "dry-run") {
    return (
      `features.${name}.provider is "dry-run" — orders can be created and previewed, ` +
      `but nothing is actually printed or posted (see B492)`
    );
  }
  // B435. The same shape as the Stripe note above and for the same reason: a
  // provider that is wired, funded and configured still posts nothing until
  // `live` is true, and "is this instance actually putting cards in the post"
  // must be a question /api/health answers rather than one somebody guesses
  // at from a deploy log.
  if (name !== "postcards") return undefined;
  return feature.live === true
    ? `features.postcards.live is true — ${provider} PRINTS AND POSTS real cards, and real money moves`
    : `features.postcards.live is not set — ${provider} renders a free sample of every card and dispatches none of them`;
}

/**
 * `credits` is on, but which world is it charging in — B792.
 *
 * The capability is about whether a journal is *metered*, and that is true
 * with or without a way to pay: an instance with no Stripe key still spends
 * credits on sends, it just settles a purchase by the operator approving a
 * mail by hand (B425). So this is a note rather than a reason, exactly like
 * `dry-run` printing.
 *
 * The mode comes from the key's own prefix and nothing else, which is the
 * whole of B792's switch — see `lib/stripe.ts`. Printing it here is what makes
 * "is production actually taking money" a question `/api/health` answers,
 * rather than one somebody guesses at from a deploy log.
 */
function paymentProviderNote(name: FeatureName): string | undefined {
  if (name !== "credits") return undefined;
  const mode = stripeMode();
  if (!mode) {
    return (
      `no payment provider is configured (${stripeProblem()}) — a credit purchase ` +
      `is approved by hand by the operator instead (see B425)`
    );
  }
  if (stripeProblem()) {
    return `Stripe is half-configured (${stripeProblem()}) — purchases fall back to the operator approving by hand`;
  }
  return mode === "test"
    ? "payments settle through Stripe in TEST mode — no real money moves, and no card is ever charged"
    : "payments settle through Stripe in LIVE mode — real money moves";
}

/**
 * B710: `reverseUrl` is guessed from `url` unless an instance says otherwise,
 * and the guess fails silently (`reversePlace` never throws). Naming the URL
 * actually in use here is what lets an operator catch a wrong guess without
 * reading `lib/addressLookup.ts`.
 */
function addressLookupNote(name: FeatureName): string | undefined {
  if (name !== "addressLookup") return undefined;
  return `reverse lookups are sent to ${addressLookupEndpoints().reverseUrl}`;
}

function optionOf(feature: Record<string, unknown>, key: string): string | undefined {
  const v = feature[key];
  return typeof v === "string" ? v : undefined;
}

/** Extra env a capability needs because of *how* it was configured. */
function configuredEnv(name: FeatureName, feature: Record<string, unknown>): {
  env: readonly string[];
  problem?: string;
} {
  if (name === "mail") {
    const transport = optionOf(feature, "transport") ?? "file";
    const env = TRANSPORT_ENV[transport];
    if (!env) {
      return {
        env: [],
        problem: `features.mail.transport "${transport}" is unknown (expected one of: ${Object.keys(TRANSPORT_ENV).join(", ")})`,
      };
    }
    return { env };
  }
  if (name === "whatsapp") {
    const backend = optionOf(feature, "backend") ?? "dry-run";
    const env = WHATSAPP_BACKEND_ENV[backend];
    if (!env) {
      return {
        env: [],
        problem: `features.whatsapp.backend "${backend}" is unknown (expected one of: ${Object.keys(WHATSAPP_BACKEND_ENV).join(", ")})`,
      };
    }
    return { env };
  }
  if (name === "signup") {
    const backend = optionOf(feature, "phoneBackend") ?? "dry-run";
    const env = PHONE_VERIFY_BACKEND_ENV[backend];
    if (!env) {
      return {
        env: [],
        problem: `features.signup.phoneBackend "${backend}" is unknown (expected one of: ${Object.keys(PHONE_VERIFY_BACKEND_ENV).join(", ")})`,
      };
    }
    // The whatsapp backend delivers through `features.whatsapp`, so a signup
    // pointed at it while that capability is off would take a person's phone
    // number and then have no way to send the code — B1222. Absent rather
    // than broken: say so here, where /api/health explains it.
    if (backend === "whatsapp" && loadServerConfig().features.whatsapp.enabled !== true) {
      return {
        env,
        problem: 'features.signup.phoneBackend is "whatsapp" but features.whatsapp is not enabled',
      };
    }
    // B1234: inbound proof needs the webhook receiving (whatsappInbound) and
    // the reply sending (whatsapp) both on, and a number for the wa.me link.
    if (backend === "whatsapp-inbound") {
      const features = loadServerConfig().features;
      if (features.whatsapp.enabled !== true || features.whatsappInbound.enabled !== true) {
        return {
          env,
          problem:
            'features.signup.phoneBackend is "whatsapp-inbound" but features.whatsapp and ' +
            "features.whatsappInbound must both be enabled",
        };
      }
      if (typeof features.whatsapp.number !== "string" || features.whatsapp.number.trim() === "") {
        return {
          env,
          problem: 'features.signup.phoneBackend is "whatsapp-inbound" but features.whatsapp.number is not set',
        };
      }
    }
    return { env };
  }
  if (name === "transcription") {
    const backend = optionOf(feature, "backend") ?? "dry-run";
    const env = SPEECH_BACKEND_ENV[backend];
    if (!env) {
      return {
        env: [],
        problem: `features.transcription.backend "${backend}" is unknown (expected one of: ${Object.keys(SPEECH_BACKEND_ENV).join(", ")})`,
      };
    }
    return { env };
  }
  if (name === "postcards" || name === "photobook") {
    const provider = optionOf(feature, "provider") ?? "dry-run";
    const env = PROVIDER_ENV[provider];
    if (!env) {
      return {
        env: [],
        problem: `features.${name}.provider "${provider}" is unknown (expected one of: ${Object.keys(PROVIDER_ENV).join(", ")})`,
      };
    }
    return { env };
  }
  if (name === "addressLookup") {
    const provider = optionOf(feature, "provider") ?? "photon";
    // No "unknown provider" problem here, unlike the two blocks above: those
    // enumerate backends this codebase has actual client code for, and this
    // one is a single GET request that works the same against any of them.
    const env = ADDRESS_LOOKUP_PROVIDER_ENV[provider] ?? ["ADDRESS_LOOKUP_API_KEY"];
    return { env };
  }
  if (name === "fulfilmentRelay") {
    // B589. No secret and no enumerable provider — this names another
    // Fernscout instance, not a printer, and there is no default the way
    // `photon` is one for addressLookup. An empty url is the shipped default,
    // so this is what makes "enabled and unconfigured" a boot-time problem
    // rather than a job that silently goes nowhere.
    const url = optionOf(feature, "url");
    if (!url) {
      return {
        env: [],
        problem: `features.fulfilmentRelay is enabled but features.fulfilmentRelay.url is not set (which fulfilment instance to hand jobs to)`,
      };
    }
    return { env: [] };
  }
  return { env: [] };
}

/**
 * `fulfilmentAccept` needs two things `Requirement.needs` cannot express,
 * because `needs` only asks whether a dependency resolves `.enabled` — B589.
 *
 * Accepting a job from another instance means actually printing it and
 * getting paid for it here, so this instance needs `postcards` or
 * `photobook` enabled with a **real** provider — not `dry-run`, which
 * relays nothing that was not already possible locally, exactly the claim
 * `dryRunNote()` makes for a self-hoster's own orders — plus a configured
 * payment method, read from `stripeMode()` the same way `paymentProviderNote`
 * does.
 */
function fulfilmentAcceptProblem(): string | undefined {
  const hasRealPrinter = (name: "postcards" | "photobook"): boolean => {
    const state = resolveOne(name);
    if (!state.enabled) return false;
    const provider = optionOf(loadServerConfig().features[name], "provider") ?? "dry-run";
    return provider !== "dry-run";
  };
  if (!hasRealPrinter("postcards") && !hasRealPrinter("photobook")) {
    return (
      "features.fulfilmentAccept is enabled but neither features.postcards nor features.photobook " +
      "is enabled with a real provider (both are off or still on dry-run) — there is nothing here to fulfil a job with"
    );
  }
  if (!stripeMode()) {
    return `features.fulfilmentAccept is enabled but no payment method is configured (${stripeProblem()})`;
  }
  return undefined;
}

function hasDatabase(): boolean {
  return typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL !== "";
}

/**
 * Server capability is a ceiling; user config is an opt-in inside it.
 *
 * A capability is on for a user only when the server *can* provide it — it has
 * the credentials — and the user has asked for it. A user can therefore never
 * switch on something the server cannot do, which is what keeps "enabled but
 * unconfigured" a server-side boot error rather than something a user could
 * trigger from their own config file.
 *
 * `OPERATOR_ONLY_FEATURES` (lib/config.ts) is the exception, and only in the
 * second half: the server's answer is still a ceiling, the journal simply has
 * no vote under it. B611 put the two printing capabilities there, because they
 * spend the operator's money and not the journal's.
 */
function resolveOne(name: FeatureName, username?: string): CapabilityState {
  const feature = loadServerConfig().features[name];
  if (!feature.enabled) {
    return { name, enabled: false, reason: "not enabled on this server" };
  }

  if (username) {
    const user = getUser(username);
    if (!user) return { name, enabled: false, reason: `no such user "${username}"` };
    // Read after the server check above, never before it, which is what makes
    // a user's `true` incapable of widening anything.
    //
    // "Not enabled by" covers two different situations and the config parser
    // decides which: for an opt-in capability a journal that never mentioned
    // it lands here, and for `mail` only a journal that wrote `false` does —
    // absence there inherits the server's answer instead. `USER_DEFAULT_FEATURES`
    // in lib/config.ts carries the reasoning; B60 is what it cost to get wrong.
    if (
      !(OPERATOR_ONLY_FEATURES as readonly string[]).includes(name) &&
      !user.features[name]?.enabled
    ) {
      return { name, enabled: false, reason: `not enabled by ${username}` };
    }
  }

  const base = REQUIREMENTS[name];

  // What this capability needs somebody else to have switched on first —
  // B724. Refusing to come on is the honest answer, and the reason says which
  // of the two switches to throw. Asked without a username on purpose: a
  // dependency is a property of the instance, and a journal cannot satisfy one
  // its server has not.
  for (const [dependency, why] of Object.entries(base.needs ?? {})) {
    if (!resolveOne(dependency as FeatureName).enabled) {
      return {
        name,
        enabled: false,
        reason: `features.${name} is enabled but features.${dependency} is not (${why})`,
      };
    }
  }

  const extra = configuredEnv(name, feature);
  if (extra.problem) return { name, enabled: false, reason: extra.problem };

  if (name === "fulfilmentAccept") {
    const problem = fulfilmentAcceptProblem();
    if (problem) return { name, enabled: false, reason: problem };
  }

  if (base.db && !hasDatabase()) {
    return {
      name,
      enabled: false,
      reason: `features.${name} is enabled but DATABASE_URL is not set (this capability stores data)`,
    };
  }

  const missing = [...base.env, ...extra.env].filter((key) => !process.env[key]);
  if (missing.length > 0) {
    return {
      name,
      enabled: false,
      reason: `features.${name} is enabled but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`,
    };
  }
  const note = dryRunNote(name, feature) ?? addressLookupNote(name) ?? paymentProviderNote(name);
  return note ? { name, enabled: true, note } : { name, enabled: true };
}

/** The state of every capability. Cheap enough to call freely — config is
 * memoised and the rest is env lookups. */
export function resolveCapabilities(username?: string): Record<FeatureName, CapabilityState> {
  const out = {} as Record<FeatureName, CapabilityState>;
  for (const name of FEATURE_NAMES) out[name] = resolveOne(name, username);
  return out;
}

/**
 * The only question most code should ask.
 *
 * Note this is deliberately *not* "is it configured" — a capability that is on
 * in config but missing a credential reports false here, and `assertCapabilities`
 * is what turns that into a loud failure at boot. Callers get to stay simple.
 */
export function isEnabled(name: FeatureName, username?: string): boolean {
  return resolveOne(name, username).enabled;
}

/**
 * Whether this journal has **said no** to a capability.
 *
 * Narrower than `!isEnabled(name, username)`, and the difference is the point:
 * that asks "is this on for them", which folds in the server's answer and
 * whether the journal can be resolved at all. This asks only whether the
 * journal's own config states a refusal.
 *
 * The three answers it distinguishes for `mail`, whose user-level default is
 * on (`USER_DEFAULT_FEATURES` in lib/config.ts): a stated `false` is a no;
 * absence is not; and **a journal that cannot be read is not a no either.**
 * That last one is why this function exists. `getUser` returns null for an
 * unreadable content root as readily as for a name that was never a journal —
 * `getUsernames` catches its own `readdirSync` failure and returns an empty
 * list — so gating mail on `isEnabled` meant an I/O fault silently suppressed
 * every journal's letters. Silent suppression on "cannot tell" is the same
 * failure B60 was sent back to remove, one layer down.
 *
 * Failing open here costs at most one letter to a journal that had said no,
 * during an outage in which its config is unreadable. Failing closed costs
 * every journal's mail, silently, for as long as the fault lasts. Note also
 * that nothing about *where* a message may be written rests on this: the
 * content-root guard in `mailDir` is that boundary and is unchanged.
 *
 * For an opt-in capability this answers the same as `isEnabled` minus the
 * server check, because absence there really is a no.
 */
export function hasSwitchedOff(name: FeatureName, username: string): boolean {
  return getUser(username)?.features[name]?.enabled === false;
}

/**
 * Fail the boot when a capability is switched on but cannot work.
 *
 * The alternative — starting anyway — means finding out at 3am when someone
 * presses send, which is the exact failure this project cannot afford while
 * its author is on a bus in Vietnam.
 */
export function assertCapabilities(): void {
  const config = loadServerConfig();
  const broken: string[] = [];
  for (const name of FEATURE_NAMES) {
    if (!config.features[name].enabled) continue;
    const state = resolveOne(name);
    if (!state.enabled) broken.push(state.reason);
  }
  if (broken.length > 0) {
    throw new Error(
      `Some capabilities are enabled but not configured:\n  - ${broken.join("\n  - ")}\n` +
        `Set the variables above, or turn the feature off in site/config.json.`,
    );
  }
}
