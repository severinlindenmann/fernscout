#!/usr/bin/env node
// Is this build complete enough to serve? — B1429.
//
// On 2026-09-11 an ordinary deploy built, restarted, reported success, and
// answered /api/health with `ok` while /<user>/contacts returned 500:
//
//   Invariant: The client reference manifest for route "/[user]/contacts"
//   does not exist. This is a bug in Next.js.
//
// The code was fine — the same commit, built again, served the page. What
// shipped was an incomplete `.next`, and every gate in front of it was
// looking somewhere else. `next build` exits 0. /api/health renders no page,
// so it is green on a build that cannot render one. And the page that broke
// is owner-only, so no unauthenticated smoke test would have touched it.
//
// This looks at the artefacts instead, which is the one place the fault is
// actually visible: **every page.js that Next writes gets a
// page_client-reference-manifest.js beside it.** On a healthy build of this
// repository that held for all 57 pages; on the broken one it did not hold
// for `/[user]/contacts`. No credentials, no requests, no route list to keep
// in step with the app, and it covers the owner-only pages a smoke test
// cannot reach.
//
// Deliberately not a general "is the build good" check. It answers one
// question that has bitten this instance once, and it answers it exactly.
//
//   node scripts/check-build.mjs [.next]
//
// Exit 0 and say how many pages were checked; exit 1 naming every route whose
// manifest is missing. Exit 2 if there is nothing here to check at all, which
// is a different fault and must not read as "all good".

import { readdir, access } from "node:fs/promises";
import path from "node:path";

const PAGE = "page.js";
const MANIFEST = "page_client-reference-manifest.js";

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Every directory under `root` holding a built page, with whether its client
 * reference manifest is there too.
 *
 * The route is the directory path, which is how Next names it in the error —
 * `app/[user]/contacts` reads back as the route that will 500, so an operator
 * reading the deploy output knows which page to open.
 */
async function pages(root) {
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // a directory that is not there is not a missing manifest
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(path.join(dir, entry.name));
      else if (entry.name === PAGE) {
        found.push({
          route: "/" + (path.relative(root, dir) || ""),
          ok: await exists(path.join(dir, MANIFEST)),
        });
      }
    }
  }
  await walk(root);
  return found;
}

const dist = process.argv[2] ?? ".next";
const root = path.join(dist, "server", "app");
const built = await pages(root);

if (built.length === 0) {
  console.error(
    `check-build: no pages under ${root} — this is not a finished build, ` +
      "and a deploy must not restart onto it.",
  );
  process.exit(2);
}

const broken = built.filter((p) => !p.ok);
if (broken.length > 0) {
  console.error(
    `check-build: ${broken.length} of ${built.length} pages have no client ` +
      `reference manifest. Each of these renders a 500, not a slow page:`,
  );
  for (const p of broken) console.error(`    ${p.route}`);
  process.exit(1);
}

console.log(`check-build: ${built.length} pages, every client reference manifest present`);
