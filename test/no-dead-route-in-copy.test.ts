import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * B1676 / B1677 — a route this codebase tells a caller to use must exist.
 *
 * The v2 migration deleted twenty-odd `/api/v1` routes, and not every string
 * naming one moved with them. These are not doc comments: they are what a
 * caller is *told to do next*. `missing_token` said "every /api/v1 call needs
 * one". The handover response handed back a status URL that 404s. And
 * `/content-model.json` — the document an agent reads to learn which call
 * writes which field — advertised `POST /api/v1/journals` as the way to make a
 * journal, which is the worst of them, because that document exists to be
 * followed literally.
 *
 * An agent following any of those calls a 404: the API telling a caller to do
 * something that cannot be done, which is the exact failure the migration was
 * for.
 *
 * **Scope, and why it stops where it does.** Comment lines are excluded — a
 * module comment naming the route its code used to be is a record of where the
 * code came from, and correct as history. Everything else in `lib/` and `app/`
 * is in: a path inside a string literal is something somebody is being told,
 * whether it reaches them through a response body, a generated document or a
 * page.
 *
 * The narrow exception is a path introduced by `moved from` or `was`, which is
 * a statement about history rather than an instruction — those are allowed to
 * name a door that is gone, because naming it is the whole point.
 */

const ROOTS = ["lib", "app"];

/**
 * A route path in a string, and whether history was claimed for it.
 *
 * The lookbehind is what keeps `lib/api/v2/schemas/trip.ts` — a source file
 * this codebase refers to constantly — from reading as a URL.
 */
const MENTION = /([Mm]oved from |was )?(?<![A-Za-z0-9])(\/api\/v[12]\/[A-Za-z0-9{}<>[\]_.:/-]*)/g;

/**
 * The version named on its own, with no path after it — B1716.
 *
 * `missing_token` survived the sweep above for a year of this test's life by
 * saying "Every /api/v1 call needs one": a prefix in prose, not a path, so
 * `MENTION` never matched it and `routeExists` was never asked. It is the
 * first sentence an unauthenticated caller of *any* door reads, and it sent
 * every one of them to a version whose write surface is gone.
 *
 * Only `v1`, and deliberately: `/api/v2` is the API this server serves, so a
 * string naming it is telling the truth. There is no equivalent way to be
 * wrong about it short of naming a door, which `MENTION` already covers.
 */
const BARE_V1 = /([Mm]oved from |was )?(?<![A-Za-z0-9])\/api\/v1(?![A-Za-z0-9/])/g;

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** A comment line, by the only test that needs no parser. */
function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("*") || trimmed.startsWith("//") || trimmed.startsWith("/*");
}

/**
 * Does a route file exist for this path?
 *
 * Segment by segment against `app/`: a literal directory first, then any
 * `[param]` one, which is what a `{user}` or `<user>` placeholder stands for.
 */
function routeExists(routePath: string): boolean {
  let dir = path.join(process.cwd(), "app");
  for (const segment of routePath.replace(/^\//, "").split("/").filter(Boolean)) {
    const literal = path.join(dir, segment);
    if (fs.existsSync(literal) && fs.statSync(literal).isDirectory()) {
      dir = literal;
      continue;
    }
    const dynamic = fs
      .readdirSync(dir, { withFileTypes: true })
      .find((e) => e.isDirectory() && e.name.startsWith("["));
    if (!dynamic) return false;
    dir = path.join(dir, dynamic.name);
  }
  return fs.existsSync(path.join(dir, "route.ts"));
}

describe("every API route named in something a caller reads", () => {
  test("resolves to a route file, unless it is named as history", () => {
    const dead: string[] = [];

    for (const root of ROOTS) {
      for (const file of sources(root)) {
        // A route file naming its own path is the authority on it; checking it
        // against itself proves nothing.
        if (file.startsWith(path.join("app", "api", "v"))) continue;

        const lines = fs.readFileSync(file, "utf8").split("\n");
        lines.forEach((line, index) => {
          if (isComment(line)) return;
          // `${base}/api/v1/${user}/status` is one path with two holes in it,
          // and a matcher that stopped at the first `${` would read it as the
          // bare prefix `/api/v1` and report the wrong thing. A template hole
          // is a path segment whose value is decided at runtime, so it stands
          // in for exactly what `[user]` does on disk.
          const flattened = line.replace(/\$\{[^}]*\}/g, "_");
          for (const match of flattened.matchAll(MENTION)) {
            const [, history, routePath] = match;
            if (history) continue;
            const cleaned = routePath.replace(/[.,:/{}<[`-]+$/, "");
            // `…/route` and `…/route.ts` point at the file implementing a
            // door, not at a URL anybody is told to call.
            if (/\/route(\.ts)?$/.test(cleaned)) continue;
            if (routeExists(cleaned)) continue;
            dead.push(`${file}:${index + 1} — ${cleaned}`);
          }
          for (const match of flattened.matchAll(BARE_V1)) {
            if (match[1]) continue;
            dead.push(`${file}:${index + 1} — /api/v1, named as the API a caller should use`);
          }
        });
      }
    }

    expect(
      dead,
      "These name a route with no file behind it, and a caller following one " +
        "gets a 404. Repoint each at the door that exists — or, where naming " +
        'the dead route IS the point, put "moved from" or "was" in front of ' +
        "it, which says history rather than instruction.\n" +
        dead.join("\n"),
    ).toEqual([]);
  });
});
