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
 *
 * **B687 split it into scopes.** "Your words" and "your photographs" are not
 * the same promise — one sends what somebody typed, the other sends the
 * pictures themselves — and a person who agreed to the first was never asked
 * about the second. So a consent now names *what* it covers, and a route
 * checks its own scope rather than "has this journal ever said yes to
 * anything". A file written before this split carries no `scopes` at all; it
 * is read as `["words"]`, because that is the only thing the old panel ever
 * asked about.
 *
 * **B689 adds a fourth, `statement`.** A bank statement is not "your words":
 * it is a record of somebody's whole financial life for the period it covers,
 * most of which has nothing to do with any trip, and a person who agreed to
 * send the sentence they typed has said nothing about it. What actually
 * leaves is narrow — the header row and five sample rows, never the file —
 * and the panel says exactly that, which is only a promise worth making
 * because it is asked for on its own.
 *
 * **B686 adds a third, `speech`.** Audio is neither of the other two: it is
 * the person's own voice, and it names a *second* provider — the transcriber,
 * not the model. So it is asked for separately and never inferred from
 * either. `provider` below therefore names whoever the most recently agreed
 * panel named; each panel names its own provider in its own words before the
 * yes, which is where a person actually reads it.
 */

export const HELPER_SCOPES = ["words", "photos", "speech", "statement"] as const;
export type HelperScope = (typeof HELPER_SCOPES)[number];

export type HelperConsent = {
  /** When consent was last given or extended, as a whole UTC instant. */
  agreedAt: string;
  /** Who the words would be going to, recorded as it stood at the time — so a
   *  change of provider is not silently covered by an old yes. */
  provider: string;
  /** What was actually agreed to. Never widened by anything but a fresh POST
   *  naming the new scope. */
  scopes: HelperScope[];
};

/** Exported so a journal's own export (`lib/exportZip.ts`) can carry the
 *  record alongside it — B722. Owner-only: the file is only ever queued into
 *  the `"all"` export scope, never `"open-to-link"`. */
export function consentFile(username: string): string {
  // Belt and braces: every caller has already resolved the journal, but this
  // joins a name onto a path and a name is a security boundary.
  if (!isValidUsername(username)) throw new Error(`helper: bad username "${username}"`);
  return path.join(userDir(username), "helper-consent.json");
}

export function helperConsent(username: string): HelperConsent | null {
  try {
    const raw = JSON.parse(fs.readFileSync(consentFile(username), "utf8")) as Partial<HelperConsent>;
    if (typeof raw.agreedAt !== "string" || typeof raw.provider !== "string") return null;
    const scopes = Array.isArray(raw.scopes)
      ? raw.scopes.filter((s): s is HelperScope => (HELPER_SCOPES as readonly string[]).includes(s))
      : (["words"] as HelperScope[]); // pre-B687 file: the only thing the old panel ever asked about.
    return { agreedAt: raw.agreedAt, provider: raw.provider, scopes };
  } catch {
    // No file, unreadable file, or nonsense in it: all three mean "nobody has
    // said yes here", which is the only safe reading of a missing consent.
    return null;
  }
}

/** Whether this journal has said yes to this particular scope — never inferred
 *  from having said yes to another one. */
export function hasHelperConsent(username: string, scope: HelperScope): boolean {
  return helperConsent(username)?.scopes.includes(scope) ?? false;
}

/** Records a scope, adding it to whatever this journal had already agreed to
 *  rather than replacing it — agreeing to "photos" does not require
 *  re-agreeing to "words". */
export function recordHelperConsent(
  username: string,
  provider: string,
  scope: HelperScope = "words",
): HelperConsent {
  const existing = helperConsent(username);
  const scopes = existing?.scopes.includes(scope) ? existing.scopes : [...(existing?.scopes ?? []), scope];
  const consent: HelperConsent = { agreedAt: new Date().toISOString(), provider, scopes };
  fs.writeFileSync(consentFile(username), `${JSON.stringify(consent, null, 2)}\n`);
  return consent;
}

export function revokeHelperConsent(username: string): void {
  fs.rmSync(consentFile(username), { force: true });
}
