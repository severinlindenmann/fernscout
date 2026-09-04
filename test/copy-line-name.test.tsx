import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentHandover from "@/components/AgentHandover";
import CopyLine from "@/components/CopyLine";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B199 — one accessible name carrying one thing.
 *
 * The agent-handover block on `/<user>/me` copies two values: the address of
 * the guide, and the address a sign-in code is sent to. `CopyLine` named
 * itself by reciting what it holds, so the button announced
 *
 *     Copy link: https://fernscout.ch/documentation.txt\nowner@example.test
 *
 * — a URL and an email address run together in one string, joined by a
 * newline that screen readers announce inconsistently or not at all, under a
 * name claiming to copy a link. It is the first control a new owner is
 * pointed at and its whole purpose is handing two exact strings to somebody
 * else, so arriving with one is a real way to be wrong about what was copied.
 */

const DOC = "https://fernscout.ch/documentation.txt";
const EMAIL = "owner@example.test";

function render(node: React.ReactNode, locale = "en"): string {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      {node}
    </LocaleProvider>,
  );
}

/** Every `aria-label` in the markup, unescaped. */
function names(html: string): string[] {
  return [...html.matchAll(/aria-label="([^"]*)"/g)].map(([, value]) =>
    value
      .replaceAll("&#x27;", "'")
      .replaceAll("&quot;", '"')
      .replaceAll("&#x2F;", "/")
      .replaceAll("&amp;", "&"),
  );
}

describe("the agent-handover copy control", () => {
  test("names what it copies instead of reciting two values", () => {
    const html = render(<AgentHandover docUrl={DOC} email={EMAIL} />);
    const dict = dictionaryFor("en");

    expect(names(html)).toContain(dict["me.agentCopy"]);
    // The two values are not in the name — they are page text, one per line,
    // which is where a reader can take them one at a time.
    expect(names(html).join(" ")).not.toContain(DOC);
    expect(names(html).join(" ")).not.toContain(EMAIL);
    expect(html).toContain(DOC);
    expect(html).toContain(EMAIL);
  });

  test("no accessible name on the block carries a newline", () => {
    const html = render(<AgentHandover docUrl={DOC} email={EMAIL} />);
    for (const name of names(html)) {
      expect(name).not.toMatch(/[\n\r]|&#10;|&#xa;/i);
    }
    expect(names(html).length).toBeGreaterThan(0);
  });

  test("and it is translated, not English on a journal that is not", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(<AgentHandover docUrl={DOC} email={EMAIL} />, locale);
      const expected = dictionaryFor(locale)["me.agentCopy"];
      expect(expected).toBeTruthy();
      expect(names(html)).toContain(expected);
      if (locale !== "en") expect(expected).not.toBe(dictionaryFor("en")["me.agentCopy"]);
    }
  });
});

/**
 * The other caller — the invite panel — hands over exactly one value, and
 * reciting it is the right name for that. B79 verified it; this is what stops
 * the fix above from quietly changing it.
 */
describe("a copy control holding a single value", () => {
  test("still names the value it holds", () => {
    const url = "https://fernscout.ch/alex/invite/guest/abc123";
    const html = render(<CopyLine value={url} label="Copy link" copiedLabel="Copied" />);
    expect(names(html)).toEqual([`Copy link: ${url}`]);
  });
});
