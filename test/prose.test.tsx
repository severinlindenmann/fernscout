import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EntryContent from "@/components/EntryContent";
import LocaleProvider, { useI18n } from "@/components/LocaleProvider";
import Prose from "@/components/Prose";
import { dictionaryFor } from "@/lib/locales";
import { contentFor } from "@/lib/prose";
import { proseTree, withProse } from "@/lib/proseTree";
import type { Day, Entry } from "@/lib/types";

/**
 * The story page's prose is rendered on the server and drawn in the browser
 * from data (`lib/prose.ts`), so the reader no longer downloads a markdown
 * parser. The one promise that makes that a pure saving: the page looks
 * exactly as it did. These hold the two renderings to the same HTML, over
 * everything GFM can produce and everything a hostile day could try.
 */

const RICH = `# Heading one

A paragraph with **bold**, _emphasis_, ~~struck~~, \`code\`, a [link](https://example.org "Title"),
and an autolink www.example.com plus a bare https://example.net/path?x=1&y=2.

> A quote
> over two lines

1. first
2. second
   - nested *item*
   - [ ] open task
   - [x] done task

| Left | Centre | Right |
| :--- | :----: | ----: |
| a    | b      | c     |
| **d** | [e](/e) | \`f\` |

![A picture](/example/media/x.jpg "Caption")

\`\`\`js
const x = 1 < 2;
\`\`\`

---

A footnote reference[^1].

[^1]: The note itself.

Line one\\
line two.
`;

const HOSTILE = `<script>alert(1)</script>

<img src=x onerror=alert(1)>

[click](javascript:alert(1)) and ![x](javascript:alert(2))

<div onclick="alert(3)">raw block</div>

A "quote" & an <b>inline</b> tag.`;

describe("prose rendered on the server draws exactly what EntryContent draws", () => {
  test.each([
    ["rich GFM", RICH],
    ["hostile input", HOSTILE],
    ["empty", ""],
    ["plain words", "Nothing much happened, which was the point."],
  ])("%s", (_name, markdown) => {
    const direct = renderToStaticMarkup(<EntryContent markdown={markdown} />);
    const drawn = renderToStaticMarkup(<Prose tree={proseTree(markdown)} />);
    expect(drawn).toBe(direct);
  });

  test("raw HTML stays text and a javascript: link goes nowhere", () => {
    const html = renderToStaticMarkup(<Prose tree={proseTree(HOSTILE)} />);
    // Every tag the day tried to write arrives as escaped text, never as an
    // element: no real tag in the output carries a handler.
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+=/i);
    expect(html).not.toContain("javascript:");
  });

  test("the tree is plain JSON — it travels in story.json", () => {
    const tree = proseTree(RICH);
    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});

describe("Prose refuses what the markdown could never have produced", () => {
  test("an unknown tag keeps its text, and handlers and raw HTML props are dropped", () => {
    const html = renderToStaticMarkup(
      <Prose
        tree={[
          "div",
          { className: "prose", onClick: "alert(1)", dangerouslySetInnerHTML: "x" } as never,
          [["script", null, ["alert(2)"]], ["iframe", { src: "https://evil.example" }, []], "words"],
        ]}
      />,
    );
    expect(html).toBe('<div class="prose">alert(2)words</div>');
  });
});

describe("withProse", () => {
  const entry = (slug: string, content: string, de?: string) =>
    ({
      slug,
      content,
      translations: de ? { de: { title: "T", content: de } } : undefined,
    }) as unknown as Entry;

  test("renders each update, keyed by slug, in the reader's language", () => {
    const a = entry("a", "English words", "Deutsche Wörter");
    const b = entry("b", "Only English");
    const day = { date: "2026-01-01", lead: a, entries: [a, b] } as Day;
    const [de] = withProse([day], "de", "en");
    const text = (slug: string) => renderToStaticMarkup(<Prose tree={de.prose![slug]} />);
    expect(text("a")).toContain("Deutsche Wörter");
    // No German version: the language it was written in, as `localized` does.
    expect(text("b")).toContain("Only English");
    const [en] = withProse([day], "en", "en");
    expect(renderToStaticMarkup(<Prose tree={en.prose!.a} />)).toContain("English words");
  });

  test("contentFor picks the language a reader reads in", () => {
    const e = entry("a", "written", "übersetzt");
    expect(contentFor(e, "en", "en")).toBe("written");
    expect(contentFor(e, "de", "en")).toBe("übersetzt");
    expect(contentFor(e, "hu", "en")).toBe("written");
    // A German journal read in German is its own words, translation or not.
    expect(contentFor(e, "de", "de")).toBe("written");
  });

  // The prose is chosen on the server and the title in the browser, by
  // `LocaleProvider.localized`. If the two rules ever parted, a reader would
  // get a German heading over English words.
  test.each([
    ["en", "en"],
    ["de", "en"],
    ["hu", "en"],
    ["de", "de"],
    ["en", "de"],
  ])("contentFor agrees with localized() for a %s reader of a %s journal", (locale, written) => {
    function Probe({ e }: { e: Entry }) {
      return <>{useI18n().localized(e).content}</>;
    }
    for (const e of [entry("a", "written", "übersetzt"), entry("b", "only written")]) {
      const viaProvider = renderToStaticMarkup(
        <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)} writtenLocale={written}>
          <Probe e={e} />
        </LocaleProvider>,
      );
      expect(viaProvider).toBe(contentFor(e, locale, written));
    }
  });
});
