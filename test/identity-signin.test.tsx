import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Landing from "@/components/Landing";
import IdentitySignIn from "@/components/IdentitySignIn";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B426 — the front door.
 *
 * B411 gave the root page something to show a signed-in reader and no way for
 * anybody to become one: five links, none of them a sign-in, and the only
 * routes to an identity were the API itself and a journal's own page. The
 * feature shipped and could not be reached, which is the failure worth a test
 * rather than the markup.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {node}
    </LocaleProvider>,
  );
}

const landing = (
  <Landing
    siteName="Fernscout"
    docUrl="https://example.test/documentation.txt"
    agentUrl="https://example.test/agent.md"
    journals={[]}
    codeMinutes="30"
  />
);

describe("the root page's way in", () => {
  /**
   * On the server render, which is what a first-time visitor is handed before
   * any JavaScript has decided anything. Waiting for the fetch would leave the
   * page's whole audience without a door for a beat.
   */
  test("offers a sign-in on first paint", () => {
    const html = render(landing);
    expect(html).toContain("Sign in to read");
  });

  /**
   * B427: it is a card above the fold addressed to the reader, not a word in
   * the corner beside the language switcher. The person it is for does not
   * know they are looking for "sign in" — they know somebody shared a journal
   * with them — so the heading has to say that back to them.
   */
  test("names the reader before it names the action", () => {
    const html = render(landing);
    expect(html).toContain("Has someone shared a travel journal with you?");
    // Above the hero, which is the pitch for the other audience entirely.
    expect(html.indexOf("Has someone shared")).toBeLessThan(
      html.indexOf("A travel journal your agent writes for you."),
    );
  });

  /** The airmail frame is the agent block's signature and the one thing this
   * page is remembered by. A second one would make it wallpaper. */
  test("does not borrow the agent block's airmail border", () => {
    const html = render(landing);
    expect(html.match(/repeating-linear-gradient/g) ?? []).toHaveLength(1);
  });

  test("still leads with the pitch, which is what a stranger came for", () => {
    const html = render(landing);
    expect(html).toContain("A travel journal your agent writes for you.");
    expect(html).toContain("Hand this to your agent");
  });
});

describe("the sign-in form", () => {
  test("asks for an address first, and nothing else", () => {
    const html = render(<IdentitySignIn codeMinutes="30" onDone={() => {}} />);
    expect(html).toContain("Your email address");
    expect(html).toContain('type="email"');
    // The code field belongs to the second step and must not be here yet.
    expect(html).not.toContain('autocomplete="one-time-code"');
  });

  /**
   * `GuestSignIn` says "if that address has access" because a journal's
   * sign-in is a question about who reads that journal. This one is not: an
   * identity is issued to any address that proves itself, because it opens
   * nothing by itself. Repeating the hedge here would imply the code depends
   * on something the reader may not have.
   */
  test("does not hedge about whether the address has access", () => {
    const html = render(<IdentitySignIn codeMinutes="30" onDone={() => {}} />);
    expect(html).not.toContain("has access");
  });

  test("says how long the code lasts, from the constant", () => {
    const html = render(<IdentitySignIn codeMinutes="30" onDone={() => {}} />);
    // The sentence lives on the second step; what matters here is that the
    // number is interpolated rather than written into the locale file.
    expect(dictionaryFor("en")["home.signInSent"]).toContain("{minutes}");
  });
});
