import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentWizard from "@/components/AgentWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The photograph step, in German — B768.
 *
 * `<input type="file">` draws its own button and its own "No file chosen" in
 * the *browser's* locale, from strings no CSS and no attribute can reach. A
 * German-speaking person on an English-configured phone — which is most phones
 * handed down or bought abroad — read two English words at the moment they
 * were being asked to hand over their photographs.
 *
 * What is asserted is the shape of the remedy, because that is what a later
 * "tidy-up" would undo: our own words on a `<label>`, our own count in place
 * of the browser's, and the input still in the accessibility tree — `sr-only`
 * clips it, `display: none` would remove it and take the keyboard with it.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function render() {
  return renderToStaticMarkup(
    <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
      <AgentWizard
        username="alex"
        trips={[{ id: "t", title: "Eine Reise", start: "2026-05-01", end: "2026-05-30" }]}
        drafts={[]}
        currency={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}
        helper={{
          enabled: false,
          consented: false,
          speech: false,
          consentedSpeech: false,
          speechProvider: "dry-run",
          consentedPhotos: false,
          credits: 1,
        }}
      />
    </LocaleProvider>,
  );
}

describe("the file picker speaks the journal's language", () => {
  test("our own words on a label in front of the input", () => {
    const html = render();
    expect(html).toContain("Fotos wählen");
    expect(html).toContain('for="wizard-pick"');
  });

  test("our own count in place of the browser's “No file chosen”", () => {
    expect(render()).toContain("Keine Fotos gewählt");
  });

  test("the input is clipped, never removed — the keyboard still reaches it", () => {
    const html = render();
    expect(html).toContain("peer sr-only");
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("display: none");
  });
});
