import { FEATURE_NAMES, OPERATOR_ONLY_FEATURES, loadServerConfig, type FeatureName } from "./config";
import { getUser } from "./users";
import { addressLookupEndpoints } from "./addressLookup";
import { stripeMode, stripeProblem } from "@paid/credits/lib/stripe";
import { reviewLoginNote } from "./auth/reviewLogin";
import { PAID_AREAS } from "@paid/manifest";

/** Capabilities whose implementation lives in paid/ (open core). Their
 *  switches stay in config for compatibility; a build without paid/ refuses
 *  them rather than pretending. */
const PAID_FEATURES: readonly string[] = ["photobook", "postcards", "whatsapp", "whatsappInbound"];

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
  // B2115. Backend-specific, like whatsapp/sms/transcription above:
  // `dry-run` needs nothing, which is what keeps the iPhone shell's push
  // developable with no Apple developer account. See APNS_BACKEND_ENV.
  applePush: { env: [], db: false },
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
  // B1316. Backend-specific, like whatsapp above: `dry-run` needs nothing,
  // which is what keeps this developable with no Twilio account. See
  // SMS_BACKEND_ENV in configuredEnv().
  sms: { env: [], db: false },
  // B1316. Reading the webhook needs the auth token (Twilio signs each
  // delivery with it — X-Twilio-Signature) and a database for the rows the
  // /admin inbox reads; a webhook that stores nothing reads nothing.
  smsInbound: { env: ["TWILIO_AUTH_TOKEN"], db: true },
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
  // B2217. A shadow-only hillshade under a photobook's route map, sampled
  // from AWS's keyless "Terrarium" elevation tiles
  // (https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png)
  // — no account, no key, so this needs no env of its own. No database
  // either: the fetched tiles are cached as files under `dataDir()`, not
  // rows, the same way mail's `.eml` files are. Off by default like every
  // optional capability, and *absent* rather than broken when it is: a
  // failed fetch, an offline instance or this switched off all draw the map
  // exactly as it printed before this ticket. Depends on `photobook` because
  // the relief layer has nowhere else it ever draws.
  mapRelief: { env: [], db: false, needs: { photobook: "the relief layer only ever draws on a photobook's route map" } },
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
    // Open core: no longer `needs: { credits }` (B684 did). With credits on,
    // every model call is still metered through `spend`; with credits off
    // (or not in this build) the helper is the operator's own, unmetered.
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
    // Open core: no longer `needs: { credits }` (B686 did) — see helper above.
  },
  // Needs somebody to be signed in as, and the helper because every question
  // this asks is a helper turn. Transcription is deliberately *not* required —
  // without it the flow is the typing one, which is a whole feature rather
  // than a broken one.
  extract: {
    env: ["SESSION_SECRET"],
    db: false,
    needs: {
      auth: "somebody has to be signed in to import into their own journal",
      helper: "the questions this asks are helper turns",
    },
  },
  // B589. Names a `url` in config, checked in configuredEnv() alongside the
  // other per-feature config problems, so an unset one refuses the same way
  // a missing environment variable does.
  fulfilmentRelay: { env: [], db: false },
  // B589. Nothing here fits `needs` — that only asks whether a dependency is
  // `.enabled`, and this depends on postcards/photobook being enabled *with a
  // real provider*, and on a payment method. See fulfilmentAcceptProblem().
  fulfilmentAccept: { env: [], db: false },
  // B2200. Needs nothing of its own: `placeForDay` reads the offline place
  // index already shipped in the repo (lib/ingest/geo.ts) and the journal's
  // own `gps/` folder on disk — no key, no database row, no third party.
  routeRecording: { env: [], db: false },
  // B2341. No hard requirement of its own: a configured storeUrl needs
  // neither mail nor a database, and the waitlist half degrades to "renders
  // nothing" rather than a boot failure when mail or the database is
  // missing — see iosAppNote() below, which is where /api/health explains
  // which of the two states this instance is actually in.
  iosApp: { env: [], db: false },
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
 * What each SMS backend needs — B1316. `twilio` here is the plain Messages
 * API and its own From number, not the Verify service the signup backend of
 * the same name uses.
 */
const SMS_BACKEND_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  twilio: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
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
  // B1316. The code rides `features.sms`, whose own backend names what it
  // needs — the cross-capability check is in the signup branch below.
  sms: [],
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

/**
 * What each APNs backend needs — B2115. `apns` needs the provider key triple
 * (`APNS_TOPIC`/`APNS_ENVIRONMENT` have defaults — see lib/push/apns.ts —
 * so they are not requirements) plus `push`'s own database-free posture:
 * subscriptions themselves live wherever `push`'s already do, and this
 * capability only decides whether a *send* reaches Apple for real.
 */
const APNS_BACKEND_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  apns: ["APNS_KEY_ID", "APNS_TEAM_ID", "APNS_KEY"],
};

const PROVIDER_ENV: Record<string, readonly string[]> = {
  "dry-run": [],
  stannp: ["STANNP_API_KEY"],
  swisspost: ["SWISSPOST_USERNAME", "SWISSPOST_PASSWORD"],
  peecho: ["PEECHO_API_KEY"],
  gelato: ["GELATO_API_KEY"],
  cloudprinter: ["CLOUDPRINTER_API_KEY"],
  // Lulu is OAuth2 client credentials rather than a static key, so it needs a
  // pair. See the photobook provider doc with the paid features.
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
  // B435, and B1113 one supplier along: a provider that is wired, funded and
  // configured still does nothing real until `live` is true, and "is this
  // instance actually printing and posting" must be a question /api/health
  // answers rather than one somebody guesses at from a deploy log.
  if (name === "postcards") {
    return feature.live === true
      ? `features.postcards.live is true — ${provider} PRINTS AND POSTS real cards, and real money moves`
      : `features.postcards.live is not set — ${provider} renders a free sample of every card and dispatches none of them`;
  }
  // Gelato's own word for the not-live state is a draft order
  // (orderType: "draft" — lib/photobook/gelato.ts): validated and never
  // charged. Ships as part of the one order with no separate postal step, so
  // unlike postcards there is no "AND POSTS" to say.
  return feature.live === true
    ? `features.photobook.live is true — ${provider} PRINTS real books, and real money moves`
    : `features.photobook.live is not set — ${provider} validates the order as a draft and prints nothing`;
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
 * whole of B792's switch — see `paid/credits/lib/stripe.ts`. Printing it here is what makes
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
/**
 * B2115. Same shape as `dryRunNote`, one capability over: `enabled: true`
 * alone does not say whether a send actually reaches Apple, and
 * `/api/health` is where an operator finds out rather than discovering it
 * the first time an invite never buzzes a phone.
 */
function applePushNote(name: FeatureName, feature: Record<string, unknown>): string | undefined {
  if (name !== "applePush") return undefined;
  const backend = optionOf(feature, "backend") ?? "dry-run";
  return backend === "dry-run"
    ? 'features.applePush.backend is "dry-run" — the payload is written under <dataDir>/apns/ and nothing reaches a phone'
    : "features.applePush.backend is \"apns\" — notifications are sent to Apple for real";
}

function addressLookupNote(name: FeatureName): string | undefined {
  if (name !== "addressLookup") return undefined;
  return `reverse lookups are sent to ${addressLookupEndpoints().reverseUrl}`;
}

/**
 * Who this instance will actually take, which `enabled: true` does not say.
 *
 * Since B1693 `signup` has no `enabled` switch: it is on wherever the server
 * can do it at all — a database and a `SESSION_SECRET` — and
 * `features.signup.inviteOnly` is what narrows it. That default is `true`, so
 * the ordinary state of a fresh instance is a capability reporting `enabled:
 * true` while `POST /api/auth/codes` answers `403 signup_not_invited` to
 * everybody the operator has not named.
 *
 * Both halves are right and the pair reads as a contradiction, which is what
 * B1694 found: an operator checking `/api/health` on a closed alpha is told
 * their instance is open to the public. `/api/health` is the one place they
 * look to find out what their own instance is doing, so being technically
 * correct there is not enough — a limit belongs where a caller can read it
 * before they hit it, and this one is currently only discoverable by being
 * refused.
 *
 * A note rather than `enabled: false`, for the same reason `dryRunNote` is
 * one: the capability genuinely is on. An invited address completes a signup
 * today.
 */
function signupNote(name: FeatureName, feature: Record<string, unknown>): string | undefined {
  if (name !== "signup") return undefined;
  // The same expression `inviteOnly()` in lib/inviteList.ts uses, read off the
  // same merged config object rather than by importing it: that module is
  // `server-only` and pulls in ./db, and this one deliberately touches neither
  // — `hasDatabase()` below reads the environment variable rather than opening
  // a handle, for the same reason.
  return feature.inviteOnly !== false
    ? 'features.signup.inviteOnly is true — only addresses this instance\'s operator has named in /admin can make a journal; everybody else is refused with "signup_not_invited"'
    : "features.signup.inviteOnly is false — anybody with an email address can make a journal on this instance";
}

/**
 * Which of the two doors the landing page actually offers — B2341.
 *
 * `enabled: true` alone does not say whether a visitor sees a link to the
 * App Store or a waitlist form, or nothing at all: that depends on
 * `features.iosApp.storeUrl` and, when it is unset, on `mail` and the
 * database both being available. A note rather than `enabled: false` in the
 * last case, for the same reason `dryRunNote` is one — the capability
 * genuinely is on, an operator turned it on, and the honest thing to say is
 * why the button is not there rather than pretending the switch is off.
 */
function iosAppNote(name: FeatureName, feature: Record<string, unknown>): string | undefined {
  if (name !== "iosApp") return undefined;
  const storeUrl = optionOf(feature, "storeUrl");
  if (storeUrl) {
    return `features.iosApp.storeUrl is set to ${storeUrl} — the landing page links straight to the App Store and shows no waitlist form`;
  }
  const mailOk = resolveOne("mail").enabled;
  if (!mailOk || !hasDatabase()) {
    return (
      "features.iosApp.storeUrl is not set, and the waitlist cannot work " +
      `(${!mailOk ? "mail is not enabled" : "DATABASE_URL is not set"}) — ` +
      "the landing page shows no app button at all"
    );
  }
  return "features.iosApp.storeUrl is not set — visitors are offered a waitlist instead";
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
  if (name === "sms") {
    const backend = optionOf(feature, "backend") ?? "dry-run";
    const env = SMS_BACKEND_ENV[backend];
    if (!env) {
      return {
        env: [],
        problem: `features.sms.backend "${backend}" is unknown (expected one of: ${Object.keys(SMS_BACKEND_ENV).join(", ")})`,
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
    // B1316: the sms backend delivers through `features.sms`, the same shape
    // as the whatsapp line below.
    if (backend === "sms" && loadServerConfig().features.sms.enabled !== true) {
      return {
        env,
        problem: 'features.signup.phoneBackend is "sms" but features.sms is not enabled',
      };
    }
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
  if (name === "applePush") {
    const backend = optionOf(feature, "backend") ?? "dry-run";
    const env = APNS_BACKEND_ENV[backend];
    if (!env) {
      return {
        env: [],
        problem: `features.applePush.backend "${backend}" is unknown (expected one of: ${Object.keys(APNS_BACKEND_ENV).join(", ")})`,
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

/** Exported for lib/appWaitlist.ts, which needs the same env-presence
 *  answer this file's own `resolveOne` uses — checking a *real* connection
 *  would mean opening one just to decide whether a button renders. */
export function hasDatabase(): boolean {
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
  if (PAID_FEATURES.includes(name) && !PAID_AREAS.includes(name)) {
    return { name, enabled: false, reason: `features.${name} is enabled but it is not included in this build` };
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
  const note =
    dryRunNote(name, feature) ??
    applePushNote(name, feature) ??
    addressLookupNote(name) ??
    paymentProviderNote(name) ??
    signupNote(name, feature) ??
    iosAppNote(name, feature) ??
    (name === "auth" ? reviewLoginNote() : undefined);
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
    // B1693: `signup` has no switch any more — it is on wherever the server
    // can do it. "You enabled this and did not configure it" would be a false
    // accusation, and refusing to boot for want of a database an operator
    // never asked for one is worse: an instance with no DATABASE_URL is a
    // legitimate instance that cannot take signups, which `/api/health`
    // already says in a sentence.
    if (name === "signup") continue;
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
