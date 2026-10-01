import "server-only";

/**
 * Which environments a StoreKit transaction's or App Store Server
 * Notification's own `environment` field may claim before the server even
 * looks at its signature — B2633. A Sandbox transaction, or an Xcode
 * Simulator run, is genuinely Apple-signed (Sandbox) or signed by a locally
 * pinned test root (Xcode); only this allowlist stops either from unlocking
 * a real plan on an instance that only ever sells production purchases.
 * `environment` is a required field everywhere it is read — absent is a
 * refusal, never a pass.
 *
 * `APPLE_ENVIRONMENTS` is a comma-separated list; unset, empty, or holding
 * nothing this server recognises means Production only — the safe default
 * for fernscout.ch. A dev instance testing the Simulator and a sandbox
 * tester sets `APPLE_ENVIRONMENTS=Production,Sandbox,Xcode`. Read here, in
 * core, rather than in `paid/`, so `/api/health` (`lib/capabilities.ts`) can
 * explain it without needing `paid/` present.
 */
export type AppleEnvironment = "Production" | "Sandbox" | "Xcode";

const KNOWN_APPLE_ENVIRONMENTS: readonly AppleEnvironment[] = ["Production", "Sandbox", "Xcode"];

export function allowedAppleEnvironments(): AppleEnvironment[] {
  const raw = process.env.APPLE_ENVIRONMENTS?.trim();
  if (!raw) return ["Production"];
  const allowed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AppleEnvironment => (KNOWN_APPLE_ENVIRONMENTS as readonly string[]).includes(s));
  return allowed.length > 0 ? allowed : ["Production"];
}

export function isKnownAppleEnvironment(value: unknown): value is AppleEnvironment {
  return typeof value === "string" && (KNOWN_APPLE_ENVIRONMENTS as readonly string[]).includes(value);
}
