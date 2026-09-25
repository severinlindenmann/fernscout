import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import DoneScreen, { type DoneNext } from "@/components/studio/DoneScreen";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2064 — done is a screen: a green band saying what happened, one to three
 * what-next cards, and no "Back to the studio" of its own, because the
 * studio bar already carries "← Studio".
 */

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {node}
    </LocaleProvider>,
  );
}

const card = (n: number): DoneNext => ({ title: `Title ${n}`, body: `Body ${n}`, href: `/example/studio/x${n}`, label: `Go ${n}` });
const en = dictionaryFor("en") as Record<string, string>;

describe("DoneScreen", () => {
  test("the band says exactly the sentence it was given", () => {
    const html = render(<DoneScreen username="example" done="Access is open to a@b.ch." />);
    expect(html).toMatch(/role="status"[^>]*>.*<p>Access is open to a@b.ch.<\/p>/);
  });

  test("one link per next item, and no link at all without them", () => {
    const html = render(<DoneScreen username="example" done="Saved." next={[card(1), card(2)]} />);
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('href="/example/studio/x1"');
    expect(html).toContain("Title 2");
    expect(html).toContain(en["studio.done.whatNext"]);
    expect(render(<DoneScreen username="example" done="Saved." />)).not.toContain("<a ");
  });

  test("renders no back-to-studio link of its own: the bar has it", () => {
    const html = render(<DoneScreen username="example" done="Saved." next={[card(1)]} />);
    expect(html).not.toContain("studio.flow.backToStudio");
    expect(html).not.toContain(en["studio.flow.backToStudio"]);
    expect(html).not.toMatch(/href="\/example\/studio"/);
  });

  test("one to three cards, at the type level", () => {
    // @ts-expect-error — an empty list is not a next step; leave `next` out.
    void (<DoneScreen username="e" done="d" next={[]} />);
    // @ts-expect-error — a fourth card is a menu, not a next step.
    void (<DoneScreen username="e" done="d" next={[card(1), card(2), card(3), card(4)]} />);
    void (<DoneScreen username="e" done="d" next={[card(1), card(2), card(3)]} />);
  });
});

/** Every .tsx under the studio's component and page directories. */
function studioSources(): { file: string; source: string }[] {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith(".tsx") ? [full] : [];
    });
  return ["components/studio", "app/[user]/studio"]
    .flatMap((root) => walk(path.join(process.cwd(), root)))
    .map((full) => ({ file: path.relative(process.cwd(), full), source: fs.readFileSync(full, "utf8") }));
}

describe("B2075 — every flow ends on DoneScreen, and the bar holds the only way back", () => {
  test("no studio component but the bar renders studio.flow.backToStudio", () => {
    const offenders = studioSources()
      .filter(({ file, source }) => !file.endsWith("StudioBar.tsx") && source.includes("studio.flow.backToStudio"))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test("every DoneScreen caller on useStep resets it, so ?step is cleared on done", () => {
    const callers = studioSources().filter(({ source }) => source.includes("<DoneScreen"));
    expect(callers.length).toBeGreaterThanOrEqual(9);
    const offenders = callers
      .filter(({ source }) => source.includes("useStep(") && !/\breset\(\)/.test(source))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  test("reshape ends on DoneScreen with the day and one more fix", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/studio/day/ReshapeDayFlow.tsx"), "utf8");
    expect(src).toContain("<DoneScreen");
    expect(src).toContain("studio.day.done.openDay");
    expect(src).toContain("studio.day.reshape.done.another");
  });
});
