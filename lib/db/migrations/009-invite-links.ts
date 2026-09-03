import type { MigrationDb } from "./types";

/**
 * Invite links that lead somewhere, and the places they lead to — B33.
 *
 * Until now a journal could be shared two ways: a password typed into a form,
 * or a person opening `trip.md` in an editor and adding a name to `people:`.
 * Neither is something an owner can hand over in a message, and neither can be
 * taken back from one person without taking it back from everybody. This
 * migration is the storage for the two links that replace them.
 *
 * ## `contact_invites.trip_id` comes back, and that needs saying
 *
 * `007-journal-wide-grants` dropped this column, with reasoning that was
 * right at the time: it was written `null` and read by nothing, a dimension
 * somebody had sketched and abandoned. What comes back is not that sketch.
 * The old column was going to narrow *reading* to one trip, which B41 settled
 * the other way — a guest is a guest of the journal, and a trip held back
 * from them is `private`. This one says which trip a **buddy** link is a link
 * to *join*, which is a different question with a different answer, and there
 * is no other place to put it: the token is the only thing the recipient
 * holds, so the trip has to be recorded beside its hash.
 *
 * `access_grants` is deliberately left alone. It stays journal-wide, exactly
 * as 007 made it.
 *
 * ## `trip_people`
 *
 * One row: **this contact was let onto this trip.** It is the second source
 * `peopleOf()` merges, beside the `people:` block in `trip.md`.
 *
 * Splitting that list in two is a real cost and it was argued rather than
 * assumed (B33): the trip file stops being the whole answer to "who was on
 * this". It loses to two things it cannot do. A stranger following a link must
 * not cause a file the owner owns to be rewritten; and a row can be revoked,
 * expired and listed, which is the entire reason for leaving a shared password
 * behind.
 *
 * `granted_at` is null while the row is a *request*. Redeeming a link writes
 * one; only the owner approving the contact fills that column in. So the row
 * existing is not access — the same shape as a `pending` contact, for the same
 * reason.
 */
export async function up(db: MigrationDb): Promise<void> {
  // Null for a guest link, and for every `personal` invite written before
  // this. Only a buddy link names a trip.
  await db.schema.alterTable("contact_invites").addColumn("trip_id", "text").execute();

  await db.schema
    .createTable("trip_people")
    .addColumn("id", "text", (c) => c.primaryKey())
    .addColumn("owner_id", "text", (c) => c.notNull())
    // The trip id alone, not a ref: every row here already carries the journal
    // in `owner_id`, and `deleteTrip` finds this table by looking for exactly
    // this pair of columns.
    .addColumn("trip_id", "text", (c) => c.notNull())
    // Who. A contact rather than a bare address, so that one person is one row
    // in one place — approving them, blocking them and deleting them all go
    // through the record that already exists for it, and "delete me" (the
    // GDPR path) takes their trip places with it through this cascade.
    .addColumn("contact_id", "text", (c) =>
      c.notNull().references("contacts.id").onDelete("cascade"),
    )
    // Which link they came through. Null when the row was written some other
    // way; kept because "how did this person get here" is the first thing an
    // owner wants when looking at a name they do not recognise.
    .addColumn("invite_id", "text")
    .addColumn("requested_at", "text", (c) => c.notNull())
    // Null while this is only a request. Nothing reads the row as access
    // until this is set.
    .addColumn("granted_at", "text")
    .addColumn("granted_by", "text")
    // Set rather than deleted: taking somebody off a trip should leave a trace
    // that they were on it, the same way `revokeContact` keeps the contact.
    .addColumn("revoked_at", "text")
    // Let on until. Honoured by the same `grantIsLive` rule as `access_grants`
    // — one definition of "live", in `lib/grants.ts`.
    .addColumn("expires_at", "text")
    .execute();

  // One place per person per trip. A second redemption of the same link by the
  // same person updates the row it already has rather than making another.
  await db.schema
    .createIndex("trip_people_unique")
    .on("trip_people")
    .columns(["owner_id", "trip_id", "contact_id"])
    .unique()
    .execute();

  // The lookup `peopleOf()` makes on a page render.
  await db.schema
    .createIndex("trip_people_trip")
    .on("trip_people")
    .columns(["owner_id", "trip_id"])
    .execute();

  // And the one `resolveViewer` makes: every trip in this journal one person
  // holds a place on, in a single query rather than one per trip.
  await db.schema
    .createIndex("trip_people_contact")
    .on("trip_people")
    .columns(["owner_id", "contact_id"])
    .execute();
}

export async function down(db: MigrationDb): Promise<void> {
  await db.schema.dropIndex("trip_people_contact").execute();
  await db.schema.dropIndex("trip_people_trip").execute();
  await db.schema.dropIndex("trip_people_unique").execute();
  await db.schema.dropTable("trip_people").execute();
  await db.schema.alterTable("contact_invites").dropColumn("trip_id").execute();
}
