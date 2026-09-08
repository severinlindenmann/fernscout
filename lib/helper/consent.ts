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
 * either.
 *
 * **B743 makes `providers` a map keyed by scope.** A person consents to a
 * provider *for a purpose*, not to a provider globally: `words` and `photos`
 * go to Anthropic, `speech` goes to Deepgram, and a single `provider` string
 * meant that agreeing to speech silently overwrote the record of who the
 * words consent named. A file written before this split carries a single
 * `provider` naming whoever the most recently agreed panel named; it is read
 * as that same provider for every scope the file already lists — never
 * widened onto a scope it did not already carry.
 */

/**
 * `sessions` is the odd one and says something different from the other four
 * — B976.
 *
 * Those record **who a person's words are sent to**: `words` and `photos` to
 * Anthropic, `speech` to Deepgram. This one sends nothing anywhere. A
 * conversation is kept on this instance either way, because being able to
 * return to it is a thing the owner asked for and their own history is theirs;
 * what this scope decides is whether **the operator may read it** to see what
 * to improve.
 *
 * So the panel for it must not borrow the others' words. Nobody is being asked
 * to let their holiday out of the building.
 */
export const HELPER_SCOPES = ["words", "photos", "speech", "statement", "sessions"] as const;
export type HelperScope = (typeof HELPER_SCOPES)[number];

export type HelperConsent = {
  /** When consent was last given or extended, as a whole UTC instant. */
  agreedAt: string;
  /** Who each scope's words, photographs or voice would be going to,
   *  recorded as it stood when that scope was agreed to — so a change of
   *  provider is not silently covered by an old yes. Keyed by scope, since
   *  `words`/`photos` and `speech` do not share a provider (B743). */
  providers: Partial<Record<HelperScope, string>>;
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
    const raw = JSON.parse(fs.readFileSync(consentFile(username), "utf8")) as Partial<HelperConsent> & {
      provider?: unknown;
    };
    if (typeof raw.agreedAt !== "string") return null;
    const scopes = Array.isArray(raw.scopes)
      ? raw.scopes.filter((s): s is HelperScope => (HELPER_SCOPES as readonly string[]).includes(s))
      : (["words"] as HelperScope[]); // pre-B687 file: the only thing the old panel ever asked about.
    let providers: Partial<Record<HelperScope, string>>;
    if (raw.providers && typeof raw.providers === "object") {
      providers = raw.providers;
    } else if (typeof raw.provider === "string") {
      // Pre-B743 file: one provider named for the whole record. Read as that
      // same name for every scope this file already lists — it never widens
      // what was agreed to, only says who each already-granted scope named.
      providers = Object.fromEntries(scopes.map((s) => [s, raw.provider as string]));
    } else {
      return null;
    }
    return { agreedAt: raw.agreedAt, providers, scopes };
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
 *  re-agreeing to "words". Each scope keeps its own provider (B743), so
 *  re-consenting to one scope with a new provider never touches another's. */
export function recordHelperConsent(
  username: string,
  provider: string,
  scope: HelperScope = "words",
): HelperConsent {
  const existing = helperConsent(username);
  const scopes = existing?.scopes.includes(scope) ? existing.scopes : [...(existing?.scopes ?? []), scope];
  const providers = { ...existing?.providers, [scope]: provider };
  const consent: HelperConsent = { agreedAt: new Date().toISOString(), providers, scopes };
  fs.writeFileSync(consentFile(username), `${JSON.stringify(consent, null, 2)}\n`);
  return consent;
}

/**
 * Takes back one scope, rewriting the file to the scopes that remain — B735.
 * The whole file is only removed once the last scope is gone, so withdrawing
 * photo consent leaves a standing words consent (and vice versa) rather than
 * silently taking both.
 */
export function revokeHelperConsent(username: string, scope: HelperScope): void {
  const existing = helperConsent(username);
  if (!existing) return;
  const scopes = existing.scopes.filter((s) => s !== scope);
  if (scopes.length === 0) {
    fs.rmSync(consentFile(username), { force: true });
    return;
  }
  const providers = { ...existing.providers };
  delete providers[scope];
  const consent: HelperConsent = { agreedAt: existing.agreedAt, providers, scopes };
  fs.writeFileSync(consentFile(username), `${JSON.stringify(consent, null, 2)}\n`);
}
