import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { displayPath } from "@/lib/displayPath";

/**
 * Where the two generator scripts put their output, and whether they say so
 * truthfully.
 *
 * Both write files that carry somebody's postal address — a rendered postcard
 * has it on the back, and the provider request JSON has it in plain text — and
 * both used to build their output directory from `process.cwd()` (B219). On a
 * developer's laptop that is the same string as `contentRoot()` and nothing
 * looks wrong; on a deployed instance the content root is under `DATA_DIR` and
 * the working directory is the code checkout, so a run on the server wrote
 * addresses into the directory `git pull` runs in, outside the backup. Exactly
 * B111's defect with a worse payload.
 *
 * That is why these run the scripts for real rather than reading their source:
 * the bug is invisible unless the two roots actually differ, which is the one
 * condition no unit test of a helper reproduces.
 *
 * The postcard count (B218) is checked in the same run, because it is the same
 * line of output a person reads when they check a batch against the folder
 * they are about to hand to a printer.
 */

const ROOT = process.cwd();
const NODE_BIN = process.execPath;
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");

const PHOTO = path.join(
  ROOT,
  "content",
  "example",
  "trips",
  "asia-2023",
  "media",
  "hue-to-hoi-an",
  "01.jpg",
);
const TRIP = "example/alps-2024";

/** Four made-up addresses. Nobody lives here. */
const RECIPIENTS = [
  { name: "Anna Beispiel", line1: "Musterweg 1", postcode: "3000", city: "Bern", country: "CH" },
  { name: "Bruno Beispiel", line1: "Musterweg 2", postcode: "3000", city: "Bern", country: "CH" },
  { name: "Clara Beispiel", line1: "Musterweg 3", postcode: "3000", city: "Bern", country: "CH" },
  { name: "Dora Beispiel", line1: "Musterweg 4", postcode: "3000", city: "Bern", country: "CH" },
];

let scratch: string;
let recipientsFile: string;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-generators-"));
  recipientsFile = path.join(scratch, "recipients.json");
  fs.writeFileSync(recipientsFile, JSON.stringify(RECIPIENTS));
});

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

function dir(name: string): string {
  const made = path.join(scratch, name);
  fs.rmSync(made, { recursive: true, force: true });
  fs.mkdirSync(made, { recursive: true });
  return made;
}

function entries(folder: string): string[] {
  return fs.existsSync(folder) ? fs.readdirSync(folder).sort() : [];
}

/**
 * A content root outside the checkout that still has the example journal in it.
 *
 * Symlinked rather than copied — seventeen megabytes per test is not worth it,
 * and the scripts only ever *read* through those links. `example` itself has to
 * be a real directory, or the output folder the script creates inside it would
 * land back in the checkout and the test would pass while proving nothing.
 */
function contentRootOutsideCheckout(name: string): string {
  const root = dir(name);
  const real = path.join(ROOT, "content");
  for (const entry of fs.readdirSync(real)) {
    if (entry === "example") continue;
    fs.symlinkSync(path.join(real, entry), path.join(root, entry));
  }
  const journal = path.join(root, "example");
  fs.mkdirSync(journal);
  for (const entry of fs.readdirSync(path.join(real, "example"))) {
    fs.symlinkSync(path.join(real, "example", entry), path.join(journal, entry));
  }
  return root;
}

function runPostcard(options: { cwd: string; contentDir?: string; user?: string }) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.contentDir) env.CONTENT_DIR = options.contentDir;
  else delete env.CONTENT_DIR;

  // `tsx --conditions=react-server`, not plain `node` — same as `runPhotobook`
  // below, and for the same reason `package.json`'s `postcard` script changed
  // to this (B273): `lib/postcard/contacts.ts` pulls in `lib/contacts`, which
  // imports other `lib/` modules with no file extension, and plain Node's ESM
  // loader cannot resolve a directory import at all — `server-only` aside.
  const result = spawnSync(
    NODE_BIN,
    [
      TSX,
      "--conditions=react-server",
      path.join(ROOT, "scripts", "postcard.ts"),
      "--user",
      options.user ?? "example",
      "--photo",
      PHOTO,
      "--message",
      "Hello from the road.",
      "--to",
      recipientsFile,
    ],
    { encoding: "utf8", cwd: options.cwd, env },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function runPhotobook(options: {
  cwd: string;
  contentDir?: string;
  extra?: string[];
  trip?: string;
}) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (options.contentDir) env.CONTENT_DIR = options.contentDir;
  else delete env.CONTENT_DIR;

  const result = spawnSync(
    NODE_BIN,
    [
      TSX,
      "--conditions=react-server",
      path.join(ROOT, "scripts", "photobook.ts"),
      "--trip",
      options.trip ?? TRIP,
      ...(options.extra ?? []),
    ],
    { encoding: "utf8", cwd: options.cwd, env },
  );
  return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** The `Wrote N file(s) to <dir>/` line, which is the whole report. */
function report(stdout: string): { count: number; dir: string } {
  const match = stdout.match(/Wrote (\d+) file\(s\) to (.+?)\/?\s*$/m);
  if (!match) throw new Error(`No "Wrote … file(s) to …" line in:\n${stdout}`);
  return { count: Number(match[1]), dir: match[2] };
}

describe("displayPath", () => {
  test("a file under the working directory prints relative to it", () => {
    expect(displayPath(path.join(ROOT, "content", "example", "postcards"), ROOT)).toBe(
      path.join("content", "example", "postcards"),
    );
  });

  test("a file outside the working directory prints absolute, not a ladder of ..", () => {
    const elsewhere = path.join(path.sep, "srv", "fernscout-data", "content", "example");
    const printed = displayPath(elsewhere, path.join(path.sep, "srv", "fernscout"));
    expect(printed).toBe(elsewhere);
    expect(printed.startsWith("..")).toBe(false);
  });

  test("the working directory itself prints absolute rather than empty", () => {
    expect(displayPath(ROOT, ROOT)).toBe(ROOT);
  });
});

describe("npm run postcard", () => {
  test("writes under CONTENT_DIR and leaves nothing beside the code (B219)", () => {
    const contentDir = contentRootOutsideCheckout("postcard-content");
    const before = entries(path.join(ROOT, "content", "example", "postcards"));

    const run = runPostcard({ cwd: ROOT, contentDir });
    expect(run.stderr).not.toMatch(/Error/);
    expect(run.status).toBe(0);

    const out = path.join(contentDir, "example", "postcards");
    // Not `ls -L`: the journal directory is real, so this is the temporary
    // root's own folder and not the checkout's seen through a link.
    expect(fs.lstatSync(out).isSymbolicLink()).toBe(false);
    expect(entries(out).length).toBe(RECIPIENTS.length * 4);
    expect(entries(out)).toContain("anna-beispiel-stannp-request.json");

    // Nothing appeared beside the code. Compared against what was there before
    // rather than asserted absent, because a person may have run the script by
    // hand in this checkout and the folder is gitignored.
    expect(entries(path.join(ROOT, "content", "example", "postcards"))).toEqual(before);
  });

  test("reports the number of files it actually wrote (B218)", () => {
    const contentDir = contentRootOutsideCheckout("postcard-count");
    const run = runPostcard({ cwd: ROOT, contentDir });
    expect(run.status).toBe(0);

    const out = path.join(contentDir, "example", "postcards");
    const written = entries(out);
    const said = report(run.stdout);

    // Four per recipient: the card, its front, its back and the request JSON.
    // The count used to be `recipients.length * 3`.
    expect(written.length).toBe(RECIPIENTS.length * 4);
    expect(said.count).toBe(written.length);
    expect(path.resolve(said.dir)).toBe(out);
  });

  test("the printed path finds the file (B219)", () => {
    const contentDir = contentRootOutsideCheckout("postcard-paths");
    const run = runPostcard({ cwd: ROOT, contentDir });
    expect(run.status).toBe(0);

    const lines = run.stdout.split("\n").filter((l) => l.includes(" -> "));
    expect(lines.length).toBe(RECIPIENTS.length);
    for (const line of lines) {
      const printed = line.slice(line.indexOf(" -> ") + 4).trim();
      expect(fs.existsSync(path.resolve(ROOT, printed))).toBe(true);
    }
  });

  test("with CONTENT_DIR unset it still writes to <cwd>/content", () => {
    // Run from a scratch directory rather than the checkout, so the default is
    // demonstrated without leaving files in `content/`.
    const cwd = dir("postcard-default-cwd");
    const run = runPostcard({ cwd });
    expect(run.status).toBe(0);

    const out = path.join(cwd, "content", "example", "postcards");
    expect(entries(out).length).toBe(RECIPIENTS.length * 4);
    // And says so the short way, because from there it is a path to paste.
    const said = report(run.stdout);
    expect(said.dir).toBe(path.join("content", "example", "postcards"));
    // The count again, with the two roots agreeing — so B218 is guarded even
    // if B219's fix were ever undone.
    expect(said.count).toBe(entries(out).length);
  });

  test("--user is a directory name, and a traversal in it is refused before anything is written (B242)", () => {
    const contentDir = contentRootOutsideCheckout("postcard-user-traversal");
    // Exactly `path.join(contentRoot(), owner, "postcards")` — the expression
    // that used to build the output directory unchecked. If the fix ever
    // regressed, this is where the files would land.
    const escaped = path.join(contentDir, "../../escaped");
    fs.rmSync(escaped, { recursive: true, force: true });

    const run = runPostcard({ cwd: ROOT, contentDir, user: "../../escaped" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/--user/);

    expect(fs.existsSync(escaped)).toBe(false);
    expect(fs.existsSync(path.join(escaped, "postcards"))).toBe(false);
  });
});

describe("npm run photobook", () => {
  test("writes under CONTENT_DIR and leaves nothing beside the code (B219)", () => {
    const contentDir = contentRootOutsideCheckout("photobook-content");
    const before = entries(path.join(ROOT, "content", "example", "photobooks"));

    const run = runPhotobook({ cwd: ROOT, contentDir });
    expect(run.stderr).not.toMatch(/Error/);
    expect(run.status).toBe(0);

    const out = path.join(contentDir, "example", "photobooks");
    expect(fs.lstatSync(out).isSymbolicLink()).toBe(false);
    const written = entries(out);
    expect(written).toContain("alps-2024-interior.pdf");
    expect(written).toContain("alps-2024-lulu-request.json");

    const said = report(run.stdout);
    expect(said.count).toBe(written.length);
    expect(path.resolve(said.dir)).toBe(out);

    expect(entries(path.join(ROOT, "content", "example", "photobooks"))).toEqual(before);
  });

  test("--out still puts the book exactly where it was asked to", () => {
    const contentDir = contentRootOutsideCheckout("photobook-out-content");
    const out = dir("photobook-out");

    const run = runPhotobook({ cwd: ROOT, contentDir, extra: ["--out", out] });
    expect(run.status).toBe(0);
    expect(entries(out)).toContain("alps-2024-interior.pdf");
    expect(entries(path.join(contentDir, "example", "photobooks"))).toEqual([]);
  });

  test("every path it prints finds the file", () => {
    const contentDir = contentRootOutsideCheckout("photobook-paths");
    const run = runPhotobook({ cwd: ROOT, contentDir });
    expect(run.status).toBe(0);

    const printed = run.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^(\/|[\w.-]+\/).*\.(pdf|html|json|txt)$/.test(l));
    expect(printed.length).toBeGreaterThan(0);
    for (const file of printed) {
      expect(fs.existsSync(path.resolve(ROOT, file))).toBe(true);
    }
  });

  test("--trip is a directory name, and a traversal in it is refused before anything is written (B242)", () => {
    const contentDir = contentRootOutsideCheckout("photobook-trip-traversal");
    // Before B242 the owner was sliced off the ref by hand
    // (`tripId.slice(0, tripId.indexOf("/"))`), which for "../../x/y" reads
    // ".." — one level above the content root — and joined straight onto
    // `path.join(contentRoot(), bookOwner, "photobooks")`.
    const escapedPhotobooks = path.join(contentDir, "..", "photobooks");
    fs.rmSync(escapedPhotobooks, { recursive: true, force: true });

    const run = runPhotobook({ cwd: ROOT, contentDir, trip: "../../x/y" });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/--trip/);

    expect(fs.existsSync(escapedPhotobooks)).toBe(false);
    expect(entries(path.join(contentDir, "example", "photobooks"))).toEqual([]);
  });
});
