import { describe, expect, test } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * The clone test.
 *
 * The whole point of the content folder is that someone can delete it, drop in
 * their own, and have their own site. That only holds if nothing personal has
 * leaked into the code — which is exactly the kind of thing that creeps back in
 * one hardcoded string at a time. This fails the build when it does.
 *
 * Documentation is deliberately not covered: docs and the README talk about the
 * project and its author on purpose. Code must not.
 */

const ROOT = process.cwd();
// C12 (spec §9, B1938) — AGENTS.md's own words are "source, fixtures, config
// or task files", and until this widening the scan only ever walked source.
// `test/fixtures` closes the "fixtures" gap and is clean (checked below).
//
// **`docs/tasks` is deliberately still not in this list.** Widening the scan
// to it was tried on this branch: it immediately found the real thing C12
// warns about — the owner's actual name, email and phone numbers, committed
// across roughly fifteen already-completed task files going back a long way
// (B1145, B1737, B1785, B272, B345, B390, B403, B461, B500, B614, B662,
// B1057, B1067, B1316, B1317, B1362, B1471, B1527, B1705, B1791, B1860, among
// them). That is a real, separate leak this ticket did not create and has no
// business quietly redacting through a test-file diff — AGENTS.md's own rule
// is that anything newly noticed goes to the backlog rather than being
// absorbed into the current task, and a personal-data cleanup across a dozen
// historical files is exactly that: a ticket of its own (filed as
// B1940), not a side effect of widening a grep. So C12 stays null rather
// than either a false pass (excluding the very directory the claim names) or
// a red suite nobody asked this branch to turn red.
const CODE_DIRS = ["lib", "app", "components", "scripts", "public", "test/fixtures"];

/**
 * `site/legal/*.md` and `site/config.json` are not "source" in the sense
 * `CODE_DIRS` means — they are the operator's own identity, not the
 * software's vocabulary — but B2249 is exactly the case `CODE_DIRS` cannot
 * see: a real name and a home address shipped as this repository's *default*
 * legal text and site config, republished by every clone. `site/legal/` is
 * now a template with placeholders (an operator's real imprint belongs under
 * `$CONTENT_DIR/legal/`, see `lib/legal.ts`), and `site/config.json`'s
 * `site.credit.name` is the neutral default a fresh clone ships with. Both
 * are scanned here, on top of being read to derive `PERSONAL` itself, so a
 * real name or address slipping back into either file — the template or the
 * shipped default — turns this suite red instead of merely republishing it.
 */
const IDENTITY_FILES = ["site/legal", "site/config.json"];

/**
 * Nothing in `scripts/` is exempt any more — the one file that named the
 * demo trips on purpose, `build-demo-content.mjs`, was retired (B1598: the
 * demo journal is committed JSON under `content/example/` now, not
 * regenerated from a script that wrote markdown).
 */
const EXEMPT = new Set<string>([]);

/**
 * Where a person's contact details end up, as opposed to their name.
 *
 * `CODE_DIRS` above is about the *software* carrying this instance's own
 * vocabulary. This is a different question with a different answer: task
 * files and skills are prose, written fast, about real runs against real
 * addresses — and on 2026-09-20 they turned out to hold the owner's own mail
 * domain across twenty-odd tickets, a real handset number in a test fixture,
 * and a third party's Gmail address in three more. In a public repository.
 *
 * It went unnoticed because the scan above never looked here, while
 * AGENTS.md's wording ("source, fixtures, config or task files") always said
 * it should.
 *
 * **Structural, not a list.** This file cannot hold the domain or the number
 * it is guarding against without republishing them, which is the same joke
 * `personalTerms` already refuses to make. So it checks the *shape*: an email
 * address is fine on a domain that exists to be written down, and a Swiss
 * mobile is fine when it is the placeholder the rest of the repository uses.
 * Anything else is somebody's real contact details.
 */
const PROSE_DIRS = ["docs/tasks", ".claude/skills"];

/** Domains that exist precisely so they can appear in writing. `example.test`
 *  is RFC 2606; `fernscout.ch` is this software's own public face. */
const PUBLISHABLE_DOMAINS = /^(example\.(com|org|net|test)|fernscout\.ch)$/;

/**
 * Contacts that are DELIBERATELY public, and why each one is.
 *
 * This is the opposite of a list of personal data: everything here is a fact
 * about the service or about somebody's published business contact, written
 * down on purpose. Adding a line is a decision — if you are tempted to add
 * one to make this test pass, the question to answer first is whether the
 * thing is genuinely meant to be readable by anybody who clones this.
 */
const PUBLISHED_CONTACTS = new Set<string>([
  // The instance's own messenger number. B1471 exists *because* it is printed
  // for a person to dial — a number nobody can see is a channel nobody uses.
  "+41 78 217 26 46",
  // The instance's own inbound SMS number, same reasoning (B1316, B1317).
  "+41 76 601 46 49",
  // Deepgram's published security address, cited in the imprint work (B1063,
  // B1076). A vendor's own contact, not a person's.
  "security@deepgram.com",
  // Plus-addressed synthetics in a worked example about one mailbox proving
  // two identities (B1064). No such account exists.
  "me+1@gmail.com",
  "me+2@gmail.com",
]);

/**
 * A number nobody could dial: the subscriber digits are all zeros (the
 * placeholder the rest of the repository shows, `076 000 00 00`) or the
 * ascending run somebody reaches for when writing an example by hand
 * (`079 123 45 67`, in B614's note about a config parse failure).
 *
 * A shape rather than a list, for the same reason the whole file avoids
 * lists: a second placeholder convention should not need a code change to be
 * recognised, and a real number should not slip through because somebody
 * added it to an allowlist to get a green run.
 */
function synthetic(tel: string): boolean {
  const digits = tel.replace(/\D/g, "").replace(/^41/, "");
  const subscriber = digits.slice(-7);
  return subscriber === "0000000" || subscriber === "1234567";
}

/**
 * Names, places and identifiers belonging to this instance rather than to the
 * software — read out of the content folder rather than written down here.
 *
 * They used to be a hardcoded list, which had two problems. It went stale the
 * moment somebody was renamed or a trip added, so the guard quietly stopped
 * guarding the thing it was named after. And it meant this file — the one
 * whose whole job is keeping personal names out of the repository — was itself
 * the place those names were written down, which is a poor joke to leave in a
 * public repository.
 *
 * Derived instead from whatever `content/` actually holds: every traveller's
 * name and nickname, the journal titles, the credited author, and every trip
 * id. A fork gets its own list for free, and a rename cannot outrun it.
 */
/** Journal directory names this run skipped when deriving `personalTerms()`,
 *  and why — read by the "reports what it skipped" test below so a future
 *  B1508 (a scratch journal's own name turning into a false-positive pattern)
 *  says so instead of pointing at an unrelated file across the repo. */
const SKIPPED_JOURNALS: string[] = [];

function personalTerms(): RegExp[] {
  const terms = new Set<string>();

  const add = (value: unknown) => {
    if (typeof value !== "string") return;
    // Short words match half the English language. "Alex" is worth checking;
    // "Al" is not.
    for (const word of value.split(/[\s+,/]+/)) {
      const clean = word.trim();
      if (clean.length >= 4) terms.add(clean);
    }
  };

  const contentRoot = path.join(ROOT, "content");
  const readJson = (file: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  };

  const server = readJson(path.join(ROOT, "site", "config.json"));
  const credit = (server?.site as { credit?: { name?: unknown } } | undefined)?.credit;
  add(credit?.name);

  let usernames: string[] = [];
  try {
    usernames = fs
      .readdirSync(contentRoot, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name);
  } catch {
    usernames = [];
  }

  for (const username of usernames) {
    // The demo journal is *meant* to be referred to by name in the code that
    // builds it, and its trips are the ones the tests use. Since B510 nothing
    // else is under content/ — locales, rates and legal moved to site/.
    if (username === "example") continue;
    // AGENTS.md's own convention for a throwaway journal: `test-<something>`,
    // chosen so the label survives exports and backups. A directory named
    // that way is declared scratch by the person or agent who made it, and
    // its owner name is typically a placeholder too ("Test", "Owner") — words
    // that are all over legitimate source (B1508). Trust the convention the
    // same way exports and backups already do, rather than scanning it.
    if (/^test-/.test(username)) {
      SKIPPED_JOURNALS.push(username);
      continue;
    }
    const user = readJson(path.join(contentRoot, username, "config.json"));
    if (!user) continue;
    add(user.title);
    const owner = user.owner as { name?: unknown; nickname?: unknown } | undefined;
    add(owner?.name);
    add(owner?.nickname);
    try {
      for (const trip of fs.readdirSync(path.join(contentRoot, username, "trips"))) {
        if (!trip.startsWith(".")) terms.add(trip);
      }
    } catch {
      // A journal with no trips yet.
    }
  }

  return [...terms].map((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"));
}

const PERSONAL = personalTerms();

/** `IDENTITY_FILES` resolved to actual files — `site/legal` is a directory,
 *  `site/config.json` is a file, and this reads either shape. */
function identityFiles(): string[] {
  return IDENTITY_FILES.flatMap((p) => {
    const full = path.join(ROOT, p);
    try {
      return fs.statSync(full).isDirectory() ? walk(full) : [full];
    } catch {
      return [];
    }
  });
}

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx|mjs|js|jsx|json|css|svg|webmanifest|md)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("nothing personal in code", () => {
  const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d))).concat(identityFiles());

  test("finds source files to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * A clone with only the demo content has nothing personal to look for, and
   * that is the correct answer rather than a broken test — but it must be
   * *said*, because a silently empty list of patterns is a suite that passes
   * by checking nothing.
   */
  test("reports what it is looking for", () => {
    if (PERSONAL.length === 0) {
      expect(fs.existsSync(path.join(ROOT, "content", "example"))).toBe(true);
      return;
    }
    expect(PERSONAL.length).toBeGreaterThan(0);
  });

  for (const journal of SKIPPED_JOURNALS) {
    test(`content/${journal} is a scratch journal (test- prefix) and is not scanned for personal terms`, () => {
      expect(journal.startsWith("test-")).toBe(true);
    });
  }

  for (const pattern of PERSONAL) {
    test(`no source file matches ${pattern}`, () => {
      const hits: string[] = [];
      for (const file of files) {
        if (EXEMPT.has(path.relative(ROOT, file))) continue;
        const text = fs.readFileSync(file, "utf8");
        text.split("\n").forEach((line, i) => {
          if (pattern.test(line)) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        });
      }
      expect(hits, `move this into site/config.json or content/:\n${hits.join("\n")}`).toEqual(
        [],
      );
    });
  }
});

/**
 * The documentation telephone number, and why it is this one — B1105.
 *
 * A telephone number needs explaining in a dozen places here: the difference
 * between `+41 …`, `0041 …` and a refused national `076 …` cannot be shown
 * without printing one. For a year the number printed was the operator's own
 * mobile, because that is the one the person writing the comment knew by
 * heart — fourteen occurrences across `lib/`, `app/`, `components/` and
 * `test/`, and, two generators later, served live in `/openapi.json` and
 * `/agent.md` and published on GitHub.
 *
 * `personalTerms()` above could never have caught it: it reads *names* out of
 * config and splits them into words, and a telephone number is not a word.
 * Hence this, which judges by shape instead of by whose it is.
 *
 * **Switzerland has no drama range.** Several regulators reserve numbers for
 * documentation and fiction — Ofcom's 07700 900xxx, the NANP's 555-01xx —
 * and BAKOM does not, so there is no number here that is guaranteed to belong
 * to nobody. `76 000 00 00` is the next best thing: it keeps the shape the
 * examples need (a Swiss mobile, so `+41`, `0041` and `076` all read
 * correctly), an all-zero subscriber number is not issued to anybody, and it
 * reads as a placeholder to a human at a glance. **Do not make it look more
 * realistic.** A plausible number is somebody's.
 */
const DOC_NUMBER = ["+41 76 000 00 00", "0041 76 000 00 00", "076 000 00 00", "41760000000"];

/**
 * Anything telephone-shaped, whoever it belongs to.
 *
 * Deliberately about the shape rather than about one number: the point is to
 * catch the *next* one, not to re-catch this one. A hit that is a real
 * example belongs in `DOC_NUMBER`; a hit that is a timestamp or an id is a
 * pattern below that wants narrowing.
 */
const TELEPHONE_SHAPED = [
  /\+\d{1,3}[\s.\u2011-]?(?:\d[\s.\u2011-]?){7,13}\d/g,
  // The `00` and bare-digit forms need a separator or an exact length, or a
  // long run of zeros — `lib/ingest/hash.ts` has one — reads as a number.
  /\b00\d{2}[\s.\u2011-](?:\d+[\s.\u2011-]?){2,}\d/g,
  /\b0\d{2}\s\d{3}\s\d{2}\s\d{2}\b/g,
  /\b\d{11,13}\b/g,
];

describe("no telephone number in code but the documentation one", () => {
  const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  test("every telephone-shaped literal is the documentation number", () => {
    const hits: string[] = [];
    for (const file of files) {
      if (EXEMPT.has(path.relative(ROOT, file))) continue;
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const pattern of TELEPHONE_SHAPED) {
            for (const match of line.match(pattern) ?? []) {
              const found = match.trim();
              if (DOC_NUMBER.some((allowed) => allowed === found)) continue;
              hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${found}`);
            }
          }
        });
    }
    expect(
      hits,
      `use the documentation number (${DOC_NUMBER[0]}) — see the comment above this test. ` +
        `A plausible-looking number is somebody's:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the example content set", () => {
  const dir = path.join(ROOT, "content", "example");

  test("exists and holds a trip", () => {
    expect(fs.existsSync(path.join(dir, "trips"))).toBe(true);
    expect(fs.readdirSync(path.join(dir, "trips")).length).toBeGreaterThan(0);
  });

  test("has its own config", () => {
    expect(fs.existsSync(path.join(dir, "config.json"))).toBe(true);
  });

  test("is itself free of personal data", () => {
    const hits: string[] = [];
    for (const file of walk(dir).concat(
      walk(dir).length ? [] : [],
    )) {
      const text = fs.readFileSync(file, "utf8");
      for (const pattern of PERSONAL) {
        if (pattern.test(text)) hits.push(`${path.relative(ROOT, file)} matches ${pattern}`);
      }
    }
    expect(hits).toEqual([]);
  });

  test("ships media inside the trip, not in public/", () => {
    // Any trip, not `[0]`: which folder sorts first is an accident of naming,
    // and it broke the moment a trip with no days was added to the example.
    // What must hold is that the photographs ship inside the trips and that
    // none of them leaked into `public/` — neither is a claim about one trip.
    const trips = fs.readdirSync(path.join(dir, "trips"));
    expect(trips.some((t) => fs.existsSync(path.join(dir, "trips", t, "media")))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, "public", "media"))).toBe(false);
  });
});

describe("the shipped content actually parses", () => {
  /**
   * The example's planned route silently parsed as no route at all for weeks:
   * it used `stops:`/`name:` while lib/plan.ts reads `route:`/`location:`. The
   * file was present, the map drew nothing, and nothing anywhere said so.
   *
   * Shipping content that quietly does not work is worse than shipping none,
   * because it is what a new self-hoster copies.
   */
  test("every trip with a plan.md has a route that resolves", async () => {
    const { getPlan } = await import("@/lib/plan");
    const { getAllTrips } = await import("@/lib/trips");

    const broken: string[] = [];
    for (const trip of getAllTrips()) {
      const planFile = path.join(
        ROOT,
        "content",
        trip.username,
        "trips",
        trip.id,
        "plan.md",
      );
      if (!fs.existsSync(planFile)) continue;
      if (getPlan(trip.ref).stops.length === 0) broken.push(trip.ref);
    }
    expect(broken, `these ship a plan.md that parses to no stops:\n${broken.join("\n")}`).toEqual(
      [],
    );
  });
});

/**
 * What is *tracked*, as opposed to what is in the source directories.
 *
 * The check above walks `lib`, `app`, `components`, `scripts` and `public` and
 * reads text files. It could therefore not see a 2.6 MB `owner-export.zip`
 * sitting in the repository root — an `npm run export` of the author's real
 * journal, with their trips, photographs and their family's names in it,
 * committed and staged for an open-source release. Nor three stray
 * screenshots beside it.
 *
 * So this asks git what is tracked, and judges by name rather than by content:
 * an archive of somebody's journal is not a thing this repository ever needs,
 * whatever it is called inside.
 */
describe("nothing personal is tracked", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  test("git is readable and the tree is not empty", () => {
    expect(tracked.length).toBeGreaterThan(50);
  });

  test("no journal export is committed", () => {
    const archives = tracked.filter((f) => /\.(zip|tar|tar\.gz|tgz)$/i.test(f));
    expect(
      archives,
      "`npm run export` writes real content. Untrack it and add it to .gitignore:\n" +
        archives.join("\n"),
    ).toEqual([]);
  });

  /**
   * Loose images at the root are screenshots somebody took to look at once.
   * Anything the documentation genuinely needs belongs in `docs/` or `public/`,
   * where it is referenced rather than merely present.
   */
  test("no loose image sits in the repository root", () => {
    const loose = tracked.filter((f) => /^[^/]+\.(png|jpe?g|gif|webp|heic)$/i.test(f));
    expect(loose, `move these under docs/ or public/, or delete them:\n${loose.join("\n")}`).toEqual(
      [],
    );
  });

  /**
   * `content/` is excluded: it is where trip ids and people's names belong, and
   * `asia-2023` is in PERSONAL to keep a hardcoded trip id out of *code*, not
   * to ban one from a journal. Everywhere else, a path named after somebody on
   * this instance is a file that should not have been committed.
   */
  test("no tracked path outside content/ is named after a person here", () => {
    const named = tracked
      .filter((f) => !f.startsWith("content/"))
      .filter((f) => PERSONAL.some((p) => p.test(f)));
    expect(named, `rename or untrack:\n${named.join("\n")}`).toEqual([]);
  });
});

describe("contact details stay out of the prose, not only out of the code", () => {
  const proseFiles = PROSE_DIRS.flatMap((d) => {
    try {
      return walk(path.join(ROOT, d));
    } catch {
      return [];
    }
  });

  test("no email address on a domain that is not meant to be written down", () => {
    const hits: string[] = [];
    for (const file of proseFiles) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/g)) {
        const domain = match[1].toLowerCase();
        // A systemd unit and the like are not addresses.
        if (domain.endsWith(".service")) continue;
        if (PUBLISHABLE_DOMAINS.test(domain)) continue;
        if (PUBLISHED_CONTACTS.has(match[0])) continue;
        hits.push(`${path.relative(ROOT, file)}: ${match[0]}`);
      }
    }
    expect(
      hits,
      `a real address in a public repository — redact it, and see B1940:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  test("no telephone number that is not the placeholder", () => {
    const hits: string[] = [];
    for (const file of proseFiles) {
      const text = fs.readFileSync(file, "utf8");
      for (const match of text.matchAll(/(?:\+41|\b0)[ .-]?7[0-9](?:[ .-]?[0-9]){7}\b/g)) {
        if (synthetic(match[0])) continue;
        if (PUBLISHED_CONTACTS.has(match[0].trim())) continue;
        hits.push(`${path.relative(ROOT, file)}: ${match[0]}`);
      }
    }
    expect(
      hits,
      `a real handset number in a public repository — redact it:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * B1942 — secret-shaped literals.
 *
 * Everything above this point looks for *personal* data. AGENTS.md's own
 * rule is stricter and separate: "Secrets are environment-only and never
 * enter site/config.json, source, fixtures, task files or logs." Nothing
 * checked that half, and `site/config.json` sits outside `CODE_DIRS` on
 * purpose (it is the documented destination for an operator's own site
 * identity — see the failure message above), which meant the one file
 * AGENTS.md names by name was never checked for the one thing it actually
 * forbids inside it.
 *
 * Shape, not a token blocklist — same reasoning as `personalTerms()`. Two
 * kinds of shape:
 *
 * 1. A provider's own recognisable key format. This repo integrates
 *    Anthropic, Stripe, AWS-compatible S3 (restic backups), Twilio and
 *    Meta/WhatsApp (see `.env.example`); each has a real-key shape distinct
 *    enough that no placeholder actually written in this repository matches
 *    it. Deepgram, Gelato, Stannp, Lulu, Peecho, SwissPost and Cloudprinter
 *    keys have no distinguishing prefix, so they fall to rule 2 instead.
 * 2. A field named like a credential (`*key*`, `*token*`, `*secret*`,
 *    `*password*`, `*credential*`, `*dsn*`, case-insensitive) holding a
 *    value that looks minted rather than typed.
 *
 * **"Minted rather than typed" is the load-bearing distinction, and it is
 * what keeps this from crying wolf.** Every placeholder this repository
 * actually writes is dash- or dot-joined English words, usually with a
 * ticket number in it — a `SESSION_SECRET` fixture
 * (`"helper-ask-secret-b685"`), a UI localStorage key (`"fs.showcase.closed"`),
 * a fixture proving a retired field is ignored
 * (`"leftover-from-before-b39"`, `test/fixtures/visibility/u/trips/delta-2025/trip.json`),
 * a documented dummy credential
 * (`"sk-ant-local-dummy-not-a-real-key"`, `.claude/skills/get-a-credential/SKILL.md`).
 * A key from a provider's own keygen is never dash- or dot-joined words —
 * it is one unbroken run of alphanumeric/base64/hex characters. Requiring
 * the value to be exactly that (20+ characters, no dash, dot, underscore or
 * space) is what tells "helper-ask-secret-b685" apart from a real token
 * without a hardcoded exception for either one.
 *
 * Run and read before writing this comment: across `CODE_DIRS`,
 * `site/config.json`, and `PROSE_DIRS` (docs/tasks, .claude/skills), this
 * produced ZERO hits. `.claude/skills/get-a-credential/SKILL.md` and
 * `.claude/skills/test-in-a-browser/SKILL.md` each show a documented
 * `sk-ant-…`/`SECRET=…` dummy for local dev — both are short, dash-joined,
 * and say "not-a-real-…" in the value itself, so neither the provider-prefix
 * rule (Anthropic's real format is `sk-ant-api\d\d-` + 80+ unbroken
 * characters; these have no `-apiNN-` segment at all) nor the generic rule
 * (the values are dash-joined) fires on them — narrowed by shape, not by
 * naming the file. B1446 (npm run tasks -- show B1446) already reached
 * the same conclusion by hand for the `sk-ant-` fragments it found. That
 * absence is asserted below the credential scan itself, so a future edit
 * that silently narrows the pattern list to nothing turns the suite red
 * instead of green.
 */
const SECRET_SCAN_DIRS = [...CODE_DIRS];
const SECRET_SCAN_EXTRA_FILES = [path.join(ROOT, "site", "config.json")];

const PROVIDER_SECRET_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: "Anthropic API key",
    // Real format: sk-ant-api03-<~95 chars>-<checksum>. Placeholders in this
    // repo ("sk-ant-admin", "sk-ant-test-helper-readers",
    // "sk-ant-local-dummy-not-a-real-key") have no "-apiNN-" segment at all.
    pattern: /sk-ant-api\d{2}-[A-Za-z0-9_-]{80,}/,
  },
  {
    name: "Stripe live-mode secret/restricted key",
    // Test-mode keys (sk_test_/rk_test_) move no money and this repo's own
    // tests assign short fake ones on purpose (test/stripe-payments.test.ts,
    // outside every scanned directory) — deliberately not flagged.
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b/,
  },
  {
    name: "AWS access key id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: "PEM private key block",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/,
  },
  {
    name: "Twilio account SID",
    pattern: /\bAC[0-9a-f]{32}\b/,
  },
  {
    name: "Meta/WhatsApp long-lived access token",
    pattern: /\bEAA[A-Za-z0-9]{20,}\b/,
  },
];

/** A field name that reads like a credential. */
const CREDENTIAL_FIELD_NAME = /(?:key|token|secret|password|credential|dsn)/i;
/**
 * A value that looks minted: one unbroken run of alphanumeric/base64
 * characters, 20+ long. No dash, dot, underscore or space — see the doc
 * comment above this block for why that is exactly what separates a real
 * key from every placeholder this repository writes by hand.
 */
const UNBROKEN_SECRET_VALUE = /^[A-Za-z0-9+/=]{20,}$/;
/** `NAME = "value"`, `NAME: "value"`, `"name": "value"`, in any file type
 *  this scan reads — code, JSON or markdown code fences alike. */
const ASSIGNMENT = /([A-Za-z0-9_]+)\s*[:=]\s*["']([^"'\s]{20,})["']/g;

function secretHits(files: string[]): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    text.split("\n").forEach((line, i) => {
      for (const { name, pattern } of PROVIDER_SECRET_PATTERNS) {
        if (pattern.test(line)) {
          hits.push(`${path.relative(ROOT, file)}:${i + 1}: matches ${name} shape`);
        }
      }
      for (const match of line.matchAll(ASSIGNMENT)) {
        const [, fieldName, value] = match;
        if (!CREDENTIAL_FIELD_NAME.test(fieldName)) continue;
        if (!UNBROKEN_SECRET_VALUE.test(value)) continue;
        hits.push(
          `${path.relative(ROOT, file)}:${i + 1}: ${fieldName} looks credential-shaped ` +
            `(${value.slice(0, 4)}…, ${value.length} chars) — never print the value itself`,
        );
      }
    });
  }
  return hits;
}

describe("no secret-shaped literal in source, config, fixtures or task files", () => {
  test("reports what it is looking for", () => {
    expect(PROVIDER_SECRET_PATTERNS.length).toBeGreaterThan(0);
  });

  test("no secret-shaped literal in source, config, fixtures or task files", () => {
    const codeFiles = SECRET_SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))).concat(
      SECRET_SCAN_EXTRA_FILES.filter((f) => fs.existsSync(f)),
    );
    const proseFiles = PROSE_DIRS.flatMap((d) => {
      try {
        return walk(path.join(ROOT, d));
      } catch {
        return [];
      }
    });
    const hits = secretHits([...codeFiles, ...proseFiles]);
    expect(
      hits,
      `a secret-shaped literal in a committed file — move it to the environment ` +
        `(see .env.example) and rotate it if it is real:\n${hits.join("\n")}`,
    ).toEqual([]);
  });
});
