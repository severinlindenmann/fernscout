// @scans app/**, paid/**
import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B2531 — every page outside the journal is built from one kit.
 *
 * The owner asked why /me, /schools, /agentic and the rest each looked like a
 * different site. Each had hand-rolled its own header (or only a back-link),
 * its own footer or none, an older square yellow button, and coral as
 * decoration. The kit (`components/landing/kit.tsx`, `Frame.tsx`,
 * `PageShell.tsx`, `styles.ts`) is now the only place those are drawn.
 *
 * The page list is derived, never listed: every `app/**\/page.tsx` outside
 * the journal tree (`app/at/`, which is `/@user/…` — the owner's own page, in
 * its own frame), with a page that re-exports a paid route followed into
 * `paid/`. A new page is in scope the moment it exists.
 *
 * Checked in the page file, its layouts, and what it imports from its own
 * route (`./`, `../`, `@/app/…`) or from a paid area (`@paid/…`) — the parts
 * that belong to the page rather than to the shared components.
 */

const ROOT = process.cwd();
const HAS_PAID = fs.existsSync(path.join(ROOT, "paid"));

/** Trees that are not the site's pages, each with its reason. */
const OUTSIDE = [
  // The journal and the studio: the owner's page, not Fernscout's.
  "app/at/",
  // The operator console: a tool with its own shell (B2484), not a page a
  // visitor reaches.
  "app/admin/",
];

/** The brand workbenches draw the app's own components (a day card, a
 * docket, a book), whose colours and headers are theirs: the page itself is
 * held to the kit, what it draws is not. */
const DRAWS = "app/docs/branding/";

/** Coral is not a kit colour, and green and blue are the audience tints,
 * read through `tint-*` and never named. Where a file's own colours still
 * mean something, the file and why. */
const OWN_COLOURS: Record<string, string> = {
  // The operator's own notice banner above `/` — the one place the kit keeps it.
  "app/page.tsx": "the notice banner",
  // The brand workbench documents the palette itself, coral included.
  "app/docs/branding/identity/page.tsx": "the palette's own reference",
  // Drawings of the app's own screens, whose warning, recording and delete
  // marks are coral in the app itself.
  "paid/orgs/components/PhoneMock.tsx": "a drawing of the app's screens",
  // The "proven" mark on an address the contact already confirmed — B2533:
  // the frame moved into the kit, the guide's own steps did not.
  "app/w/[code]/WelcomeGuide.tsx": "the proven/done mark, green-700",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(path.relative(ROOT, full));
  }
  return out;
}

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("./") || spec.startsWith("../")) base = path.join(path.dirname(from), spec);
  else if (spec.startsWith("@/app/") || spec.startsWith("@/components/")) base = spec.slice(2);
  else if (spec.startsWith("@paid/")) {
    if (!HAS_PAID) return null;
    base = `paid/${spec.slice(6)}`;
  } else return null;
  for (const ext of ["", ".tsx", ".ts"]) {
    const file = base + ext;
    if (fs.existsSync(path.join(ROOT, file)) && fs.statSync(path.join(ROOT, file)).isFile()) return file;
  }
  return null;
}

/** The kit itself: the one place a header, footer, main and site nav are drawn. */
const KIT = ["components/landing/", "components/home/SignedInHeader.tsx", "components/Landing.tsx"];

/** The page's own files: it, and every component it draws with, followed
 * through its imports — the kit excepted. */
function ownFiles(page: string, deep = true): string[] {
  const seen = new Set<string>();
  const queue = [page];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file) || KIT.some((k) => file.startsWith(k))) continue;
    seen.add(file);
    const src = read(file);
    for (const [, spec] of src.matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
      // Paid lib modules are data and helpers, not drawing.
      if (spec.startsWith("@paid/") && !(deep ? /\/(routes|components)\//: /\/routes\//).test(spec)) continue;
      if (!deep && !spec.startsWith("@paid/")) continue;
      const next = resolve(file, spec);
      if (next && /\.tsx$/.test(next)) queue.push(next);
    }
  }
  return [...seen];
}

function layoutsAbove(page: string): string[] {
  const out: string[] = [];
  for (let dir = path.dirname(page); dir !== "app" && dir !== "."; dir = path.dirname(dir)) {
    const layout = path.join(dir, "layout.tsx");
    if (fs.existsSync(path.join(ROOT, layout))) out.push(layout);
  }
  return out;
}

/** Whether a file returns JSX at all — a redirect-only page does not. */
const renders = (src: string) => /(return|=>)\s*\(?\s*(\/\/.*\s*)*<[A-Za-z>]/.test(src);

const pages = walk(path.join(ROOT, "app"))
  .filter((p) => !OUTSIDE.some((prefix) => p.startsWith(prefix)))
  .filter((p) => renders(read(p)) || /from "@paid\//.test(read(p)))
  .sort();

/** Source without comments: a comment naming `<main>` draws nothing. */
const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\/|\{\/\*[\s\S]*?\*\/\}|^\s*\/\/.*$/gm, "");

/** The shades that exist only for the audience tints (app/globals.css):
 * named anywhere but through `tint-*`, a page has picked its own tint. */
const TINT_ONLY = /\b[a-z-]+-(?:green-400|blue-(?:100|300|700))\b/g;

/** A shared component keeps its own meaning for coral (a notice, an error),
 * green-700 (done) and blue-500 (focus); what the page's own files may not
 * do is pick a colour at all. These three are the kit's everywhere: blue-500
 * is the focus ring and a link's underline, a green-500 dot means "included". */
const SEMANTIC = /\b(?:[a-z]+-blue-500|bg-green-500)\b/g;

/** Every way a page can draw its own frame, a retired button or a colour. */
function problems(page: string): string[] {
  const found: string[] = [];
  const files = [...ownFiles(page, !page.startsWith(DRAWS)), ...layoutsAbove(page)];
  const all = files.map(read).join("\n");
  if (!renders(all)) return found; // a redirect, or a paid route absent here
  // The homepage is where the kit comes from: `Landing` draws Frame.tsx's
  // header and footer directly, around its sign-in state.
  if (page !== "app/page.tsx" && !/<PageShell[\s>]/.test(all)) found.push(`${page}: not inside <PageShell>`);
  for (const file of files) {
    const src = code(file);
    const shared = file.startsWith("components/");
    for (const tag of ["header", "footer", "main"]) {
      if (new RegExp(`<${tag}[\\s>]`).test(src)) found.push(`${file}: its own <${tag}>`);
    }
    // A nav with a name is the page's own contents list (/legal, /docs/*);
    // an unnamed one is a second site menu.
    for (const [nav] of src.matchAll(/<nav\b[^>]*>/g)) {
      if (!/aria-label(ledby)?=/.test(nav)) found.push(`${file}: its own unnamed <nav>`);
    }
    for (const [literal] of src.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
      if (literal.includes("border-yellow-600") && literal.includes("bg-yellow-400")) {
        found.push(`${file}: the retired square yellow button`);
      }
    }
    if (file in OWN_COLOURS) continue;
    for (const [cls] of src.matchAll(TINT_ONLY)) found.push(`${file}: ${cls} — a tint is read through tint-*`);
    if (shared) continue;
    if (/\bcoral-\d/.test(src)) found.push(`${file}: coral outside the notice banner`);
    for (const [cls] of src.replace(SEMANTIC, "").matchAll(/\b[a-z-]+-(?:green|blue|sky)-\d{2,3}\b/g)) {
      found.push(`${file}: ${cls} — a page's own files name no hue; a tint is read through tint-*`);
    }
  }
  return found;
}

describe("every page outside the journal is built from the kit (B2531)", () => {
  test("the page list is derived and covers the site's pages", () => {
    // A floor, not a list: a scan that silently found nothing would pass.
    expect(pages.length).toBeGreaterThan(20);
    expect(pages).toContain("app/me/page.tsx");
    expect(pages).toContain("app/agentic/page.tsx");
  });

  test.each(pages)("%s", (page) => {
    expect(problems(page)).toEqual([]);
  });

  test("the kit itself keeps the retired button out", () => {
    for (const file of ["components/landing/styles.ts", "components/landing/kit.tsx", "components/landing/Frame.tsx"]) {
      expect(read(file)).not.toContain("border-yellow-600");
      expect(read(file)).not.toMatch(/\bcoral-\d/);
    }
  });
});
