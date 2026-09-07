import "server-only";
import fs from "node:fs";
import path from "node:path";
import { isValidUsername, userDir } from "../users";

/**
 * Consent to a model being spoken to on this journal's behalf — B684, and §6
 * of `docs/plans/2026-09-07-web-helper-agent.md`.
 *
 * **Once per journal, before the first model call ever made for it.** What the
 * panel says — the provider, what leaves the machine, what never does, what it
 * costs, that it is not training data — is in the locale file, because it is
 * words a person reads; what is here is only the record that they read them.
 *
 * A file beside the journal rather than a row: it is the journal's own answer,
 * it belongs in the journal's own backup and export, and revoking it is
 * deleting a file — which is a thing an owner can do with a shell when
 * everything else is broken. There is no database column to migrate and
 * nothing to reconcile.
 */

export type HelperConsent = {
  /** When it was given, as a whole UTC instant. */
  agreedAt: string;
  /** Who the words would be going to, recorded as it stood at the time — so a
   *  change of provider is not silently covered by an old yes. */
  provider: string;
};

function consentFile(username: string): string {
  // Belt and braces: every caller has already resolved the journal, but this
  // joins a name onto a path and a name is a security boundary.
  if (!isValidUsername(username)) throw new Error(`helper: bad username "${username}"`);
  return path.join(userDir(username), "helper-consent.json");
}

export function helperConsent(username: string): HelperConsent | null {
  try {
    const raw = JSON.parse(fs.readFileSync(consentFile(username), "utf8")) as Partial<HelperConsent>;
    if (typeof raw.agreedAt !== "string" || typeof raw.provider !== "string") return null;
    return { agreedAt: raw.agreedAt, provider: raw.provider };
  } catch {
    // No file, unreadable file, or nonsense in it: all three mean "nobody has
    // said yes here", which is the only safe reading of a missing consent.
    return null;
  }
}

export function recordHelperConsent(username: string, provider: string): HelperConsent {
  const consent: HelperConsent = { agreedAt: new Date().toISOString(), provider };
  fs.writeFileSync(consentFile(username), `${JSON.stringify(consent, null, 2)}\n`);
  return consent;
}

export function revokeHelperConsent(username: string): void {
  fs.rmSync(consentFile(username), { force: true });
}
