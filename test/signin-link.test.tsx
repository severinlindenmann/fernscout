import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import SignInButton from "@/components/SignInButton";
import { identitySignInUrl, signInUrl } from "@/lib/auth";

/**
 * B1788 — the page a reader meets before they are let in.
 *
 * Two failures on one screen, both live on fernscout.ch: the button said
 * `label`, the literal prop name, because the JSX child was written without
 * braces; and the page was rendered in the browser's language rather than the
 * one the letter carrying the link was written in.
 */
describe("the sign-in link", () => {
  test("the button says what it was given, not the word label", () => {
    const html = renderToStaticMarkup(
      <SignInButton username="ana" token="TOKEN" label="Mein Journal öffnen" working="…" failed="…" />,
    );
    expect(html).toContain("Mein Journal öffnen");
    expect(html).not.toContain(">label<");
  });

  test("the url carries the language the mail was written in", () => {
    expect(signInUrl("https://x.test", "ana", "TOKEN", "de")).toBe("https://x.test/ana/s/TOKEN?lang=de");
    // A regional tag ships no dictionary of its own; the base language does.
    expect(signInUrl("https://x.test", "ana", "TOKEN", "de-CH")).toBe("https://x.test/ana/s/TOKEN?lang=de");
    expect(identitySignInUrl("https://x.test", "TOKEN", "hu")).toBe("https://x.test/s/TOKEN?lang=hu");
  });

  test("no language, no parameter — and nothing invented is ever appended", () => {
    expect(signInUrl("https://x.test", "ana", "TOKEN")).toBe("https://x.test/ana/s/TOKEN");
    expect(signInUrl("https://x.test", "ana", "TOKEN", null)).toBe("https://x.test/ana/s/TOKEN");
    expect(signInUrl("https://x.test", "ana", "TOKEN", "englishplease")).toBe("https://x.test/ana/s/TOKEN");
  });
});
