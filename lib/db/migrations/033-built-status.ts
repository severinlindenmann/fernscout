import type { MigrationDb } from "./types";

/**
 * `print_orders.status` said `printed` for a row that only meant "the files
 * exist and this row is open for a print attempt" — `markPrinted` set it
 * before any printer was involved, and a refusal returned a row to it so it
 * stayed retryable. Nothing about the behaviour was wrong, but the one word
 * anybody would read off the table was the one claim that was definitely
 * false: 62 photobook rows and 2 postcard rows on the live instance said
 * `printed` for a book or card that never existed on paper. B1437 renames
 * the value to what it means, `built`; this rewrites what is already stored.
 *
 * A straight rewrite for both kinds — there is no ambiguity to resolve and
 * nothing to lose. `failed` is untouched; it always meant the build failed.
 */
export async function up(db: MigrationDb): Promise<void> {
  await db
    .updateTable("print_orders")
    .set({ status: "built" })
    .where("status", "=", "printed")
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db
    .updateTable("print_orders")
    .set({ status: "printed" })
    .where("status", "=", "built")
    .execute();
}
