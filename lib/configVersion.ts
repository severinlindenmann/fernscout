import "server-only";
import fs from "node:fs";
import { serverConfigPath } from "./config";

/**
 * The `content/config.json` schema version this build understands.
 *
 * Bump this whenever a change to the server config's shape would silently
 * misbehave on an older file — a renamed key, a field that changes meaning —
 * rather than just being additive (a new optional key never needs a bump: an
 * older file without it still parses fine). Record what changed and what a
 * self-hoster needs to do about it in `docs/config-upgrades.md`.
 *
 * This is deliberately its own module rather than living in lib/config.ts:
 * the version has to be readable even when the rest of the file no longer
 * matches the current schema, which is exactly the situation this exists to
 * catch — `parseServerConfig` throwing a `ConfigError` full of field-level
 * complaints is the wrong first thing to show someone whose real problem is
 * "you're six months behind."
 */
export const CURRENT_CONFIG_VERSION = 1;

export type ConfigVersionCheck =
  | { ok: true; version: number }
  | { ok: false; version: number; message: string };

/** Reads only `configVersion`, tolerating a file that is missing, unreadable,
 * or not valid JSON — those are somebody else's error to report. */
function readRawConfigVersion(): number | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(serverConfigPath(), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
  const v = (raw as Record<string, unknown>).configVersion;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Compares the installed config's version against what this build expects.
 *
 * A config with no `configVersion` at all predates this field and is read as
 * version 1 — the shape it always described — so every existing deployment
 * stays green the moment this ships, with nothing to edit until a real
 * breaking change comes along.
 */
export function checkConfigVersion(): ConfigVersionCheck {
  const version = readRawConfigVersion() ?? 1;

  if (version === CURRENT_CONFIG_VERSION) return { ok: true, version };

  if (version < CURRENT_CONFIG_VERSION) {
    return {
      ok: false,
      version,
      message:
        `content/config.json declares "configVersion": ${version}, but this build expects ` +
        `${CURRENT_CONFIG_VERSION}. A \`git pull\` brought in a config change your file ` +
        `predates. See docs/config-upgrades.md for what changed between version ${version} ` +
        `and ${CURRENT_CONFIG_VERSION} and how to migrate, then set ` +
        `"configVersion": ${CURRENT_CONFIG_VERSION} once your file matches.`,
    };
  }

  return {
    ok: false,
    version,
    message:
      `content/config.json declares "configVersion": ${version}, but this build only ` +
      `understands up to ${CURRENT_CONFIG_VERSION}. The content folder was set up by a newer ` +
      `version of the app than the one currently running — update the app ` +
      `(\`git pull && npm install\`) before starting it again.`,
  };
}

/**
 * Boot check — see `instrumentation.ts`. Throws with a message naming the
 * versions and pointing at the migration notes, rather than letting an
 * outgrown config surface as a `ConfigError` about some field that changed
 * meaning three releases ago, or a crash further downstream that never
 * mentions config at all.
 */
export function assertConfigVersion(): void {
  const result = checkConfigVersion();
  if (!result.ok) throw new Error(result.message);
}
