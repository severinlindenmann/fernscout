import { FEATURE_NAMES, loadServerConfig, type FeatureName } from "./config";
import { getUser } from "./users";

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
};

const REQUIREMENTS: Record<FeatureName, Requirement> = {
  reactions: { env: [], db: false },
  costs: { env: [], db: false },
  push: { env: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"], db: false },
  mail: { env: [], db: false }, // transport-specific; see mailRequirements()
  auth: { env: ["SESSION_SECRET"], db: true },
  // Self-service journal creation. Needs somewhere to keep the codes it
  // issues, and — checked in the route rather than here — mail to send them
  // with, since a signup nobody can complete is worse than one refused.
  signup: { env: ["SESSION_SECRET"], db: true },
  contacts: { env: ["CONTACTS_ENCRYPTION_KEY"], db: true },
  postcards: { env: [], db: true }, // provider-specific; see providerRequirements()
  photobook: { env: [], db: false },
};

/** Transport and provider choices carry their own credential requirements.
 * `dry-run` and `file` need nothing, which is what makes local development
 * possible with no accounts anywhere. */
const TRANSPORT_ENV: Record<string, readonly string[]> = {
  file: [],
  console: [],
  smtp: ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM"],
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

export type CapabilityState =
  | { name: FeatureName; enabled: true }
  | { name: FeatureName; enabled: false; reason: string };

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
  return { env: [] };
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
 */
function resolveOne(name: FeatureName, username?: string): CapabilityState {
  const feature = loadServerConfig().features[name];
  if (!feature.enabled) {
    return { name, enabled: false, reason: "not enabled on this server" };
  }

  if (username) {
    const user = getUser(username);
    if (!user) return { name, enabled: false, reason: `no such user "${username}"` };
    if (!user.features[name]?.enabled) {
      return { name, enabled: false, reason: `not enabled by ${username}` };
    }
  }

  const base = REQUIREMENTS[name];
  const extra = configuredEnv(name, feature);
  if (extra.problem) return { name, enabled: false, reason: extra.problem };

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
  return { name, enabled: true };
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
        `Set the variables above, or turn the feature off in content/config.json.`,
    );
  }
}
