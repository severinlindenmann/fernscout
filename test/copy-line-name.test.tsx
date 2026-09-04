import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HandoverPrompt } from "@/components/AgentHandover";
import CopyLine from "@/components/CopyLine";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/**
 * B199 — one accessible name carrying one thing.
 *
 * The agent-handover block on `/<user>/me` used to copy two values at once —
 * the address of the guide, and the address a sign-in code was sent to —
 * under a name that recited both, joined by a newline:
 *
 *     Copy link: https://fernscout.ch/documentation.txt\nowner@example.test
 *
 * B301 removed that block entirely rather than fixing its wording (the owner
 * asked for the second way in gone, not repaired), so this file no longer
 * tests it. What is left with the same shape of problem — one control, a
 * value that is not safely read back as its own name — is the button that
 * copies the *minted prompt*: also multi-line, and this time the value is a
 * live credential rather than two public addresses, which is a stronger
 * reason still not to recite it. `components/AgentHandover.tsx` already
 * passes an explicit `name` rather than letting `CopyLine` default to
 * reciting; these tests are what holds that in place.
 */

const PROMPT = [
  "This journal already exists at https://fernscout.ch/alex.",
  "Exchange this key for your own token:",
  "  POST https://fernscout.ch/api/auth/handover",
  "  Authorization: Bearer fs_handover_abc123",
  "Call GET /api/v1/alex/status first.",
].join("\n");

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

describe("the minted prompt's copy control", () => {
  test("names what pressing it does instead of reciting the credential", () => {
    const html = render(<HandoverPrompt prompt={PROMPT} expires={null} />);
    const dict = dictionaryFor("en");

    expect(names(html)).toContain(dict["me.handoverCopy"]);
    // The credential is not in the name — it is page text, in the `<pre>`
    // block, which is where a reader can actually check what they are about
    // to hand over.
    expect(names(html).join(" ")).not.toContain("fs_handover_abc123");
    expect(html).toContain("fs_handover_abc123");
  });

  test("no accessible name carries a newline", () => {
    const html = render(<HandoverPrompt prompt={PROMPT} expires={null} />);
    for (const name of names(html)) {
      expect(name).not.toMatch(/[\n\r]|&#10;|&#xa;/i);
    }
    expect(names(html).length).toBeGreaterThan(0);
  });

  test("and it is translated, not English on a journal that is not", () => {
    for (const locale of MAINTAINED_LOCALES) {
      const html = render(<HandoverPrompt prompt={PROMPT} expires={null} />, locale);
      const expected = dictionaryFor(locale)["me.handoverCopy"];
      expect(expected).toBeTruthy();
      expect(names(html)).toContain(expected);
      if (locale !== "en") expect(expected).not.toBe(dictionaryFor("en")["me.handoverCopy"]);
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
