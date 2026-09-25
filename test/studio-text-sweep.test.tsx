// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ts from "typescript";
import { afterEach, describe, expect, test, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B2093 — the text sweep across the studio, and the keepers that hold it.
 *
 * Every check here derives its list from the tree or the dictionaries; none
 * carries an allow-list. "1 days", "trip(s)", "Publicnow" and an English
 * sentence typed straight into a studio page each fail one of them.
 */

vi.mock("next/navigation", async (orig) => ({
  ...(await orig<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/alex/studio/trip/visibility",
  useSearchParams: () => new URLSearchParams(),
}));

const ROOT = path.join(import.meta.dirname, "..");
const STUDIO_DIRS = ["components/studio", "app/[user]/studio"];
const LOCALES = ["en", "de", "hu"] as const;

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(rel);
    return /\.(tsx?|mjs|js)$/.test(e.name) ? [rel] : [];
  });
}
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dictionary = (locale: string): Record<string, string> =>
  JSON.parse(read(`site/locales/${locale}.json`));
const studioFiles = STUDIO_DIRS.flatMap(walk).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

describe("counts read as counts (B2093)", () => {
  test('no locale string writes a plural as "(s)", "(en)" or "(n)"', () => {
    const hits = LOCALES.flatMap((l) =>
      Object.entries(dictionary(l))
        .filter(([, v]) => /\p{L}\((s|es|e|en|n)\)/u.test(v))
        .map(([k, v]) => `${l} ${k}: ${v}`),
    );
    expect(hits).toEqual([]);
  });

  test("a key with a .one sibling is never rendered through t(), which would ignore it", () => {
    const en = dictionary("en");
    const hits = studioFiles.flatMap((f) =>
      [...read(f).matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)]
        .filter((m) => en[`${m[1]}.one`] !== undefined)
        .map((m) => `${f}: ${m[1]}`),
    );
    expect(hits).toEqual([]);
  });

  test('a string that puts an English plural right after its number goes through tn() with a .one — "1 days" cannot render', () => {
    const en = dictionary("en");
    const counted = Object.entries(en).filter(
      // `x.many` beside `x.one` is a plural the caller picks by hand.
      ([k, v]) => !k.endsWith(".one") && !en[`${k}.one`] && !(k.endsWith(".many") && en[k.replace(/\.many$/, ".one")]) && /\{(count|days|nights|files|photos|drafts|private|read|people|trips|pins|lines)\} (?:[a-z]+ )?[a-z]+s\b/.test(v),
    );
    const hits = studioFiles.flatMap((f) => {
      const source = read(f);
      return counted
        .filter(([k]) => new RegExp(`\\bt\\(\\s*["'\`]${k.replace(/\./g, "\\.")}["'\`]`).test(source))
        .map(([k, v]) => `${f}: ${k} = ${v}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("a badge after text is its own word (B2093)", () => {
  /** A `<span className="ml-…">` is a margin-spaced inline badge. The margin
   *  is only paint: without a real space in the text before it, the
   *  accessible name and a copied line read "Publicnow". The badge is fine
   *  as a first child (nothing to glue to) or right after `{" "}`. */
  test('every margin-spaced span in the studio follows {" "} or opens its parent', () => {
    const hits = studioFiles.flatMap((f) => {
      const source = read(f);
      return [...source.matchAll(/<span className="ml-\d/g)].flatMap((m) => {
        const before = source
          .slice(Math.max(0, m.index - 300), m.index)
          // A conditional wrapper around the badge is transparent.
          .replace(/\s+$/, "")
          .replace(/(\{[^{}]*&&\s*(<>)?|\{[^{}]*\?\s*(<>)?|<>|\()\s*$/, "")
          .replace(/\s+$/, "");
        const ok = before.endsWith('{" "}') || /<[A-Za-z][^<>]*[^/]>$|<[A-Za-z]+>$/.test(before);
        return ok ? [] : [`${f}:${source.slice(0, m.index).split("\n").length}`];
      });
    });
    expect(hits).toEqual([]);
  });

  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  test('the visibility answer reads "Öffentlich jetzt" in German, a word apart', async () => {
    const { default: LocaleProvider } = await import("@/components/LocaleProvider");
    const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
    const { default: TripVisibilityFlow } = await import("@/components/studio/trip/TripVisibilityFlow");
    const { dictionaryFor } = await import("@/lib/locales");
    const preview = { id: "t", title: "Lisbon", status: "past", opens: true, publishedDays: 1, draftDays: 1, photoCount: 1 };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
          <StudioBarProvider username="alex">
            <TripVisibilityFlow
              username="alex"
              trip={{ id: "lisbon", title: "Lisbon", visibility: "public", listed: true, teaser: false }}
              visibilities={["private", "public", "guest"]}
              previews={{ public: preview, guest: preview, private: { ...preview, opens: false } } as never}
            />
          </StudioBarProvider>
        </LocaleProvider>,
      ),
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Öffentlich jetzt");
    expect(text).not.toContain("Öffentlichjetzt");
    // …and a count of one is singular in the preview beside it.
    expect(text).toContain("1 veröffentlichter Tag · 1 Foto");
    expect(text).toContain("1 Entwurfstag");
    expect(text).not.toContain("1 Entwurfstage");
  });
});

describe("the studio's own pages hold no English (B2093)", () => {
  /** JSX text, or a string literal placed as a child or a visible prop, of
   *  more than three words. Derived from the syntax tree of every studio
   *  page and component; nothing is allow-listed. */
  const VISIBLE_PROPS = /^(aria-label|title|placeholder|alt|label|lede|question|details|text|confirmLabel|busyLabel)$/;
  test("no sentence is typed straight into a studio page", () => {
    const words = (s: string) => s.trim().split(/\s+/).filter((w) => /\p{L}{2}/u.test(w)).length;
    const hits: string[] = [];
    for (const f of studioFiles.filter((x) => x.endsWith(".tsx"))) {
      const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const hit = (n: ts.Node, s: string) => {
        if (words(s) > 3) hits.push(`${f}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${JSON.stringify(s.trim())}`);
      };
      const visit = (n: ts.Node) => {
        if (ts.isJsxText(n)) hit(n, n.text);
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          if (ts.isJsxExpression(n.parent) && !ts.isJsxAttribute(n.parent.parent)) hit(n, n.text);
          const attr = ts.isJsxAttribute(n.parent) ? n.parent : ts.isJsxExpression(n.parent) && ts.isJsxAttribute(n.parent.parent) ? n.parent.parent : null;
          if (attr && VISIBLE_PROPS.test(attr.name.getText())) hit(n, n.text);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    expect(hits).toEqual([]);
  });
});

describe("the studio's locale keys are all in use (B2093)", () => {
  /** A report for the whole dictionary (printed), and a failure for the
   *  `studio.*` namespace the rebuild owns: a key there that nothing
   *  references is copy nobody can read. Read from the syntax tree of every
   *  file in app/, components/, lib/ and scripts/ (a regex over the text is
   *  thrown off by a backtick in a comment): a key is used when it, or its
   *  plural base, is a string literal; when a template literal's fixed parts
   *  match it (`studio.planReaders.${level}.description${suffix}`); or when a
   *  literal ending in "." is a prefix of it (`"agent.tool." + name`). */
  test("no studio.* key is orphaned", () => {
    const literals = new Set<string>();
    const templates: RegExp[] = [];
    const prefixes: string[] = [];
    const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const f of ["app", "components", "lib", "scripts", ...(fs.existsSync(path.join(process.cwd(), "paid")) ? ["paid"] : [])].flatMap(walk)) {
      if (f === path.join("lib", "i18n.ts")) continue;
      const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const visit = (n: ts.Node) => {
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
          literals.add(n.text);
          if (/^[\w-]+(\.[\w-]+)*\.$/.test(n.text)) prefixes.push(n.text);
        }
        if (ts.isTemplateExpression(n) && /^[\w-]+\./.test(n.head.text)) {
          templates.push(new RegExp(`^${escape(n.head.text)}${n.templateSpans.map((sp) => `[\\w.-]*${escape(sp.literal.text)}`).join("")}$`));
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    const used = (k: string) =>
      [k, k.replace(/\.one$/, "")].some(
        (x) => literals.has(x) || templates.some((r) => r.test(x)) || prefixes.some((p) => x.startsWith(p)),
      );
    // Open core: without paid/, the studio.* keys paid code uses. Written by
    // open-core/split/split.mjs from the paid/ it split off, never by hand.
    const paidKeys: string[] = fs.existsSync(path.join(process.cwd(), "paid")) ? [] : ["studio.hub.item.postcard.title","studio.postcard.trip.heading","studio.postcard.photo.heading","studio.postcard.photo.pick","studio.postcard.photo.loading","studio.postcard.photo.none","studio.postcard.photo.changeTrip","studio.postcard.photo.showMore","studio.postcard.photo.confirm","studio.postcard.photo.resume","studio.postcard.photo.altFallback","studio.postcard.nobody.addPerson","studio.postcard.error.generic","studio.postcard.off.banner","studio.postcard.off.body","studio.hub.item.photobook.title","studio.hub.cannotRun.photobook","studio.photobook.pick.subtitle","studio.photobook.pick.current","studio.photobook.pick.dayCount","studio.photobook.pick.dayCount.one","studio.photobook.pick.empty","studio.hub.resume.import.cta","studio.unfinished.heading","studio.unfinished.postcardTo","studio.unfinished.postcard","studio.unfinished.photobook","studio.unfinished.detail","studio.unfinished.discard","studio.unfinished.postcard.question","studio.unfinished.postcard.confirm","studio.unfinished.photobook.question","studio.unfinished.photobook.confirm","studio.unfinished.busy","studio.unfinished.error","studio.unfinished.sentAlready","studio.orders.lede"];
    const orphans = Object.keys(dictionary("en")).filter((k) => !used(k) && !paidKeys.includes(k));
    if (orphans.length > 0) console.info(`B2093 report: ${orphans.length} locale keys look unreferenced:\n${orphans.join("\n")}`);
    expect(orphans.filter((k) => k.startsWith("studio."))).toEqual([]);
  });
});

describe("the helper's own sentences count too (B2093)", () => {
  test('"1 thing still to answer", not "1 thing(s)"', async () => {
    const { sayIn } = await import("@/lib/helper/intents");
    const say = sayIn("en");
    expect(say("agent.tool.assembleDayMissing", { date: "2025-11-15", count: "1" })).toContain("has 1 thing still");
    expect(say("agent.tool.assembleDayMissing", { date: "2025-11-15", count: "3" })).toContain("has 3 things still");
    expect(sayIn("de")("agent.tool.assembleDayReady", { date: "2025-11-15", count: "1" })).toContain("1 Foto und");
  });
});

describe("one word for a trip, one for a credit (B2139)", () => {
  const dict = (l: string) => JSON.parse(fs.readFileSync(path.join(ROOT, "site/locales", `${l}.json`), "utf8")) as Record<string, string>;

  test('no studio or delete string says "journey"', () => {
    const offenders = Object.entries(dict("en")).filter(([k, v]) => /^(studio|del|edit|visibility)\./.test(k) && /journey/i.test(v));
    expect(offenders.map(([k]) => k)).toEqual([]);
  });

  test('German counts credits as "Credits", never "Guthaben-Punkte" or "{n} Guthaben"', () => {
    const offenders = Object.entries(dict("de")).filter(([, v]) => /Guthaben-?[Pp]unkt|Guthabenpunkt|(\}|\d) Guthaben\b/.test(v));
    expect(offenders.map(([k]) => k)).toEqual([]);
  });
});
