/**
 * /.well-known/apple-app-site-association — B2697.
 *
 * Lets this instance's own iPhone app open a sign-in link tapped in Mail
 * instead of Safari, so the token is redeemed into the app's cookie jar.
 * Only the two sign-in shapes from `lib/auth/index.ts` (`signInUrl`,
 * `identitySignInUrl`) are claimed; every other address keeps opening in
 * the browser.
 *
 * The app is the one this instance already pushes to (`APNS_TEAM_ID`,
 * `APNS_TOPIC`), so there is no second setting to keep in step. Without a
 * team id the file is absent — no app is claimed.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  const team = process.env.APNS_TEAM_ID?.trim();
  if (!team) return new Response("Not found", { status: 404 });
  const bundle = process.env.APNS_TOPIC?.trim() || "ch.fernscout.app";
  const body = {
    applinks: {
      details: [
        {
          appIDs: [`${team}.${bundle}`],
          components: [{ "/": "/s/*" }, { "/": "/@*/s/*" }],
        },
      ],
    },
  };
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
