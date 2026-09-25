import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoPicker } from "@/components/PhotoPicker";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The file picker speaks the journal's language — B768, restored by B1436.
 *
 * `<input type="file">` draws its own button and its own "No file chosen" in
 * the *browser's* locale, from strings no CSS and no attribute can reach. A
 * German-speaking person on an English-configured phone — which is most phones
 * handed down or bought abroad — read two English words at the moment they
 * were being asked to hand over their photographs.
 *
 * B1239 deleted `AgentWizard`, the step-wizard this used to be asserted
 * through, and took this coverage with it: the assertions were true of
 * `PhotoPicker` itself, not of the wizard's own state machine, so they came
 * back here against the component directly rather than through any wrapper.
 * `PhotoPicker` is still live — `EditDay` and `HelperRoom` both render it.
 */

function render(locale: "de" | "en") {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <PhotoPicker id="picker" chosen={[]} onPick={() => {}} />
    </LocaleProvider>,
  );
}

describe("the file picker speaks the journal's language", () => {
  test("our own words on a label in front of the input", () => {
    const html = render("de");
    expect(html).toContain("Dateien wählen");
    expect(html).toContain('for="picker"');
  });

  test("our own count in place of the browser's “No file chosen”", () => {
    expect(render("de")).toContain("Keine Fotos gewählt");
    expect(render("en")).toContain("No photos chosen");
  });

  test("the input is clipped, never removed — the keyboard still reaches it", () => {
    const html = render("de");
    expect(html).toContain("sr-only");
    expect(html).not.toContain("hidden");
    expect(html).not.toContain("display:none");
    expect(html).not.toContain("display: none");
  });
});
