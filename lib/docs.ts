import fs from "node:fs";
import path from "node:path";
import type { TranslationKey } from "./i18n";

/**
 * The `/docs` page's content strategy, for the parts that can honestly be
 * generated: read it off `README.md` and `CONTRIBUTING.md` at request time
 * rather than write a second copy that drifts from them (B23 makes the same
 * argument about `docs/` itself — a reference kept in two places disagrees
 * with itself within a month). Not everything on the page comes from here —
 * the "what to give it" guidance is written for the page directly, because
 * the file it would otherwise have been pulled from (`docs/ingest.md`)
 * described a pipeline this page does not want to promise (B306).
 */

/** A file already in the repository, read fresh so an edit to it reaches the
 * page with no build step of its own. `process.cwd()` is the repo root in
 * every deployment this project has — see AGENTS.md: the VPS runs a full
 * `git checkout` under `npm start`, not a pruned standalone bundle. */
export function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf-8");
}

/**
 * One `## Heading` section of a markdown file, body only.
 *
 * Matches the heading text exactly (case-sensitive, as written), and returns
 * everything up to the next heading of the same or a higher level — a `###`
 * inside the section stays in. Throws rather than returning an empty string
 * on a miss, because a silently empty section on a public page is worse than
 * a build that fails: `test/docs.test.ts` is what catches a heading this
 * relies on being renamed out from under it.
 */
export function section(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) {
    throw new Error(`section "${heading}" not found`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,2}\s/.test(line));
  return rest.slice(0, end === -1 ? undefined : end).join("\n").trim();
}

/**
 * Every documentation page, once — B470.
 *
 * The hub renders these and the inner pages render them as a nav, and both
 * read this list. Before it existed the guides were an array in one component
 * and the technical sections were anchors hand-written in another, which is
 * exactly how they came to be drawn as the same kind of control while
 * behaving differently — one navigated, one scrolled.
 *
 * **No reader guides any more.** There used to be three — for readers, owners
 * and travel buddies — as translated markdown files. Every one of
 * them had been overtaken by the screens it described: the owner's said there
 * was no editing screen and never would be, a week after the studio shipped;
 * the buddy's was a longer copy of what `/<user>/me` already says beside the
 * instructions it explains; and the reader's walked through a sign-in card
 * and an iPhone install sheet that now explain themselves
 * (`PushInstallOnboarding`). The screens carry their own guidance, so the
 * guides were retired rather than rewritten, and `/docs/guide/*` redirects to
 * the hub (`next.config.ts`).
 *
 * What is left is for somebody deciding whether to self-host, call the API,
 * send a patch or run their own agent — English, because those pages are read
 * from `README.md`, `CONTRIBUTING.md` and `docs/` at request time (B23). The
 * hub's own words are translated and say so.
 */
export type DocsPageId = "hosting" | "api" | "contributing" | "helper";

export type DocsPage = {
  id: DocsPageId;
  href: string;
  /** Resolved by whoever renders it, never here — this module is imported by
   * server components that already hold a locale. Typed rather than left as a
   * `string` so a renamed key fails the typecheck here instead of rendering
   * the key itself onto the page. */
  labelKey: TranslationKey;
  /** One sentence under the label on the hub: what is behind the link. */
  blurbKey: TranslationKey;
};

export const DOCS_PAGES: readonly DocsPage[] = [
  { id: "hosting", href: "/docs/hosting", labelKey: "docs.hosting.title", blurbKey: "docs.hosting.blurb" },
  { id: "api", href: "/docs/api", labelKey: "docs.api.title", blurbKey: "docs.api.blurb" },
  {
    id: "contributing",
    href: "/docs/contributing",
    labelKey: "docs.contributing.title",
    blurbKey: "docs.contributing.blurb",
  },
  { id: "helper", href: "/docs/helper", labelKey: "docs.helper.title", blurbKey: "docs.helper.blurb" },
];

/**
 * The same list, shaped for `DocsNav`.
 *
 * Returns a structural shape rather than importing `DocsNavEntry`: `lib/` does
 * not import from `components/`, and the two would be the same type anyway.
 */
export function docsNavEntries(): { href: string; labelKey: TranslationKey }[] {
  return DOCS_PAGES.map((page) => ({ href: page.href, labelKey: page.labelKey }));
}

/**
 * The workbenches under `/docs/branding` — the parts of this software that are
 * *drawn* rather than written.
 *
 * A third kind of documentation page, and deliberately not in `DOCS_PAGES`.
 * Those are read by somebody deciding whether to self-host, send a patch or
 * call the API, they are translated where their reader needs it, and they are
 * rendered as the nav on every one of each other. These are benches: English
 * only, not indexed, and useful only to whoever is working on the drawing —
 * a person who can see that something is wrong, or an agent that has been told
 * so and needs to find out which part.
 *
 * Kept as a list for the same reason `DOCS_PAGES` is: the hub renders it and
 * the section grows, and two hand-written copies of a menu is how `/docs` came
 * to have two menus (B470).
 */
export type BrandingBench = {
  href: string;
  title: string;
  /** What it isolates, and therefore what a fault in it points at. */
  blurb: string;
  /** The file to open when this bench shows something wrong. */
  source: string;
};

export const BRANDING_BENCHES: readonly BrandingBench[] = [
  {
    href: "/docs/branding/identity",
    title: "Identity",
    blurb:
      "The mark and the palette, read off the files that define them: every lockup rendered from disk, every hex parsed from the stylesheet, every contrast ratio computed rather than claimed.",
    source: "lib/brand.ts \u00b7 app/globals.css \u00b7 docs/branding/",
  },
  {
    href: "/docs/branding/animation",
    title: "Travel scene",
    blurb:
      "The leg between two days: vehicles, surfaces, skylines and the camera that pans between them. Hold any moment still on a slider.",
    source: "components/TravelScene.tsx",
  },
  {
    href: "/docs/branding/travellers",
    title: "Travellers",
    blurb:
      "Every axis a person can be described along — skin, hair, build, age, outfit, accessories — and the twelve starting points, drawn.",
    source: "lib/travellers/render.ts",
  },
  {
    href: "/docs/branding/day",
    title: "Day card",
    blurb:
      "A day in the states that are hard to reach on a real site: draft, half-published, marked as test, no photographs, several updates.",
    source: "components/StoryPager.tsx",
  },
  {
    href: "/docs/branding/order",
    title: "Orders",
    blurb:
      "A photobook order and a postcard order in one component, in the states a reader cannot reach: refused and refunded, a printer word nobody has mapped, a proposal that expired, a book whose files were pruned.",
    source: "components/order/OrderDocket.tsx \u00b7 lib/order/view.ts",
  },
  {
    href: "/docs/branding/photobook",
    title: "Photobook",
    blurb:
      "Every trim size drawn against the others, both covers and the spine that grows with the page count, every page kind, every switch the composer offers, and the rules that choose a layout — run rather than described.",
    source: "lib/photobook/spec.ts · lib/photobook/coverGeometry.ts · lib/photobook/plan.ts",
  },
  {
    href: "/docs/branding/postcard",
    title: "Postcard",
    blurb:
      "Where the guillotine falls on an A6 card: bleed, trim, safe area, and the address block and stamp whose position is postal specification rather than taste.",
    source: "lib/postcard/spec.ts · lib/postcard/preview.ts",
  },
];
