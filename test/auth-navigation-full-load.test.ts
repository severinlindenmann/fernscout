import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B2550 — a page kept in the router cache for 30s must never be the one a
 * sign-in, sign-out or identity switch leaves behind.
 *
 * Every one of those calls a `redeem`/`logout`/`upgrade` endpoint under
 * `app/api/auth/**` and then has to get the browser to a page that reflects
 * the *new* session — `router.push` alone can hand back a page the router
 * cached from before the cookie changed. The real fix (`WelcomeDoor.tsx`,
 * B2550) is a full load; this is the derived check for every future one:
 * scan the source rather than hand-list the files (a hand list goes stale
 * the day somebody adds a fifth flow), and require the same fetch's file to
 * also contain a full-load call.
 */

const ROOT = path.join(__dirname, "..");
/** A real `fetch(...)` call, not a doc comment naming the route — narrow
 *  enough that a POST to `/api/auth/codes` alone (only requests a code, no
 *  session change) does not match. */
const IDENTITY_CHANGING_FETCH =
  /fetch\(\s*[`"'][^`"']*\/api\/auth\/(?:codes\/redeem|links\/redeem|logout|identity\/upgrade|signup\/phone\/redeem)\b/;
/** The two components that make one of those calls and forward the result as
 *  a plain callback (`onDone`, `onSignedIn`) — the decision of *where to
 *  navigate to* lives in whoever renders them, not in the fetch itself, so a
 *  file that imports either of these owns the same obligation as one that
 *  calls the endpoint directly. Named rather than a hand-kept file list, so
 *  a third such component added later is covered the moment it is imported. */
const FORWARDS_AN_IDENTITY_CHANGE = /from ["']@\/components\/(?:IdentitySignIn|SignupWizard)["']/;
const BARE_PUSH = /\brouter\.push\(/;
const FULL_LOAD = /window\.location\.(?:reload|assign|href\s*=)|router\.refresh\(\)/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === "paid" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...tsxFiles(full));
    else if (name.endsWith(".tsx") && !name.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

describe("every sign-in/logout/identity-switch call ends in a full load", () => {
  const files = [...tsxFiles(path.join(ROOT, "app")), ...tsxFiles(path.join(ROOT, "components"))];

  test("the endpoints this check watches still exist", () => {
    // If nobody calls one of these any more the test below is vacuous —
    // catch that drift here rather than have it pass by going silent.
    const routes = fs.readdirSync(path.join(ROOT, "app/api/auth"), { recursive: true } as never) as string[];
    expect(routes.some((f) => f.toString().includes("logout"))).toBe(true);
  });

  const offenders = files.filter((f) => {
    const src = fs.readFileSync(f, "utf8");
    const changesIdentity = IDENTITY_CHANGING_FETCH.test(src) || FORWARDS_AN_IDENTITY_CHANGE.test(src);
    return changesIdentity && BARE_PUSH.test(src) && !FULL_LOAD.test(src);
  });

  test("no client file calls one of those endpoints and only ever does a bare router.push", () => {
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
