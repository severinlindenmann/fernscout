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

  // A trip that is password-protected needs something to sign its cookie with;
  // finding that out on first use means finding it out in front of a reader.
  const { assertTripAccessConfig } = await import("./lib/access");
  const { getAllTrips } = await import("./lib/trips");
  assertTripAccessConfig(getAllTrips());

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
