import "server-only";
import { requestContact } from "./index";
import { pickLocale } from "./locale";
import { isEmail } from "../auth";
import type { UserConfig } from "../config";

/**
 * Filing the rows a person agreed, from a vCard import — B1394.
 *
 * Shared between the two doors that end here: `POST /api/v1/<user>/contacts/import`
 * (an agent, or the wizard's own inbox screen) and `POST
 * /api/helper/<user>/contacts/import` (a tick per row on a card in the
 * conversation, B1394's own missing surface). Both hand this the same rows
 * and get the same outcome — one place the "every row lands `pending`, and
 * imported means nothing is sent unasked" rule is written, rather than two
 * that could drift.
 *
 * B2296 removed `sendImportedMail`: nobody asked this journal to mail a row
 * it imported. An imported row shows up on Studio › Readers under "Not
 * invited yet" instead — see `lib/readers/split.ts` — and inviting it from
 * there is the owner's own, deliberate press.
 */

/**
 * The most rows one call may file.
 *
 * A batch that big is still worth a bound even with no mail behind it: a
 * thousand rows is a thousand rows this journal now has to sort through on
 * Studio › Readers, most of them somebody who never travelled with anyone.
 *
 * `POST /api/v1/<user>/contacts/import` had this number and the helper's own
 * card route, added beside it in B1394, did not — the refactor that gave the two
 * doors one write path left the guard behind in one caller. A bound that lives
 * in the caller is a bound the next caller forgets, so it is in the writer now
 * and both doors inherit it.
 */
export const MAX_IMPORT_ROWS = 50;

export class TooManyRowsError extends Error {
  constructor(readonly count: number) {
    super(`${count} rows; one call carries at most ${MAX_IMPORT_ROWS}.`);
    this.name = "TooManyRowsError";
  }
}

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
  if (rows.length > MAX_IMPORT_ROWS) throw new TooManyRowsError(rows.length);
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

    // B2296: no mail. The row lands `pending`, `createdVia: "owner-import"`,
    // and shows up on Studio › Readers under "Not invited yet" — nobody
    // asked this journal to write to it yet.
    results.push({ name, email, outcome: result.outcome });
  }

  return results;
}
