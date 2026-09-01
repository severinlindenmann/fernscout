/**
 * Boot-time checks.
 *
 * Next.js calls `register()` once per server process, before any request is
 * served — which is the only moment where "you enabled mail and never set
 * SMTP_HOST" can still be a startup error rather than a 500 in front of a
 * reader. See docs/plans/W02-config-capabilities.md.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertCapabilities } = await import("./lib/capabilities");
  const { assertDatabaseUrl, isDatabaseConfigured, getDatabase } = await import("./lib/db");

  // Checked first: every other config error below is far more confusing to
  // read when the real problem is "this file predates the code reading it."
  const { assertConfigVersion } = await import("./lib/configVersion");
  assertConfigVersion();

  // A malformed DATABASE_URL is a typo, and a typo should stop the boot rather
  // than quietly demote the site to its no-database mode.
  assertDatabaseUrl();
  assertCapabilities();

  // A `passwordHash:` left in a trip.md is a line that no longer does
  // anything, on a trip whose owner still believes it is locked.
  const { getAllTrips } = await import("./lib/trips");
  assertNoTripPasswords(getAllTrips());

  // Running with no database at all is a supported deployment (ROADMAP §2.2),
  // so there is nothing to do here in that case.
  if (!isDatabaseConfigured()) return;

  // Best effort: open and migrate now so the first reader doesn't pay for it,
  // and so a broken migration shows up in the startup log rather than in a
  // request. Deliberately not fatal — a database that is merely slow to accept
  // connections shouldn't stop the public site, which needs none of it. The
  // next attempt happens on first use, and that one does throw.
  try {
    const handle = await getDatabase();
    console.log(`[db] ready — ${handle.target.label}`);
  } catch (err) {
    console.error("[db] not ready at boot; will retry on first use:", err);
  }
}


/**
 * Refuses to boot on a leftover trip password.
 *
 * Trip passwords are gone (B39): a trip is opened by who you are, not by what
 * you know. The check that used to live here was the mirror image — it failed
 * the boot when a `guest` trip had *no* hash — and inverting it is not
 * pedantry, because the removal **widens** access on exactly the trips that
 * were most deliberately closed. A trip that was `guest` plus a password is
 * now readable by every guest of the journal, which may be more people than
 * the password ever reached, and nothing about the file says so. Refusing to
 * serve until somebody has looked at the line is the only way that decision
 * gets made by a person.
 *
 * Fatal rather than a warning, and consistent with the two checks above it: a
 * warning in a boot log is not read, and the failure it prevents is silent.
 *
 * The key is named here and nowhere under `lib/` — see `Trip.unknownFields`.
 */
export function assertNoTripPasswords(trips: { ref: string; unknownFields?: string[] }[]): void {
  const stale = trips.filter((t) => t.unknownFields?.includes("passwordHash")).map((t) => t.ref);
  if (stale.length === 0) return;
  throw new Error(
    `These trips still carry a passwordHash: line, which no longer protects anything — ` +
      `${stale.join(", ")}. Trip passwords were removed; a trip is opened by who the ` +
      `reader is, not by a shared secret. Delete the line, and check the trip's ` +
      `visibility: while "guest" once meant "whoever holds the password", it now means ` +
      `every guest of this journal — which may be more people. Use "private" if only the ` +
      `people in its people: block should read it.`,
  );
}