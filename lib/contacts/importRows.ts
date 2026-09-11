import "server-only";
import { requestContact } from "./index";
import { pickLocale } from "./locale";
import { sendCodeMail } from "./mail";
import { isEmail, issueCode } from "../auth";
import type { UserConfig } from "../config";

/**
 * Filing the rows a person agreed, from a vCard import — B1394.
 *
 * Shared between the two doors that end here: `POST /api/v1/<user>/contacts/import`
 * (an agent, or the wizard's own inbox screen) and `POST
 * /api/helper/<user>/contacts/import` (a tick per row on a card in the
 * conversation, B1394's own missing surface). Both hand this the same rows
 * and get the same outcome — one place the "every row lands `pending`, and
 * the mail still goes" rule is written, rather than two that could drift.
 */

export type ImportRow = { name?: unknown; email?: unknown; tel?: unknown };
export type RowOutcome = {
  name: string;
  email: string;
  outcome: "created" | "updated" | "ignored" | "invalid";
};

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function importContactRows(
  user: string,
  config: UserConfig,
  rows: ImportRow[],
): Promise<RowOutcome[]> {
  const locale = pickLocale(null, config.defaultLocale);
  const results: RowOutcome[] = [];

  for (const row of rows) {
    const name = str(row.name);
    const email = str(row.email);
    const tel = str(row.tel);
    if (!name || !isEmail(email)) {
      results.push({ name, email, outcome: "invalid" });
      continue;
    }

    const result = await requestContact(user, {
      name,
      email,
      locale,
      // A number carried through and nothing else — the same shape the
      // public form uses for "I did not say" beyond it. `EMPTY_ADDRESS`
      // itself is not imported here; a postal address is not on a phone's
      // contact card the way it is on an envelope somebody already sent.
      address: tel ? { tel } : undefined,
      wantsEmailDigest: false,
      wantsPostcard: false,
      // Left untouched on purpose — B1394's own note: a vCard's TEL is
      // carried through so it is not lost, but ticking "message me on
      // WhatsApp" is a separate decision nobody made on this row's behalf.
      wantsWhatsapp: false,
      createdVia: "owner-import",
    });

    if (result.outcome === "ignored") {
      results.push({ name, email, outcome: "ignored" });
      continue;
    }

    // Best effort, the same reasoning `sendApprovedMail` and every other
    // mail in this family gets: the row already exists by the time this
    // runs, and a dead SMTP host must not undo it.
    try {
      const { code } = await issueCode(user, email, "guest");
      await sendCodeMail(user, config, email, locale, code);
    } catch {
      // The row is still pending and still correct; only the mail failed.
    }
    results.push({ name, email, outcome: result.outcome });
  }

  return results;
}
