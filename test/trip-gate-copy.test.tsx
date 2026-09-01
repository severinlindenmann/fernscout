import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TripGate from "@/components/TripGate";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { MAINTAINED_LOCALES } from "@/lib/i18n";
import { CODE_TTL_MINUTES } from "@/lib/auth";

/**
 * What the gate *says*, which is the half of B39 that is not about access.
 *
 * The password form had one state and one sentence, and it was the wrong one
 * for two of the three people who meet it. Somebody signed in who still may
 * not read this trip — a guest of the journal opening a `private` trip, or
 * anybody who signed in with the wrong address — was shown the same form
 * again. They will fill it in a second time, get the same page, and conclude
 * the site is broken; the answer they need is knowable only on this side.
 *
 * Nothing here asserts on access. `mayReadTrip` has already said no by the
 * time this renders; see `test/access-gate.test.ts` for who it says no to.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function render(
  over: { signedInAs?: string | null; canSignIn?: boolean; locale?: string } = {},
) {
  const locale = over.locale ?? "en";
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <TripGate
        tripTitle="Four days round the Alps"
        username="alex"
        journalTitle="Alex's journal"
        signedInAs={over.signedInAs ?? null}
        canSignIn={over.canSignIn ?? true}
        codeMinutes={CODE_TTL_MINUTES}
      />
    </LocaleProvider>,
  );
}

describe("a reader who is not signed in", () => {
  test("is asked for an address, and never for a password", () => {
    const html = render();
    expect(html).toContain("signin-email");
    expect(html).not.toMatch(/password/i);
    expect(html).not.toContain('type="password"');
  });

  test("is told which trip it is, so the tab and the page agree", () => {
    expect(render()).toContain("Four days round the Alps");
  });

  /** A door that leads nowhere is worse than no door: the endpoints 404. */
  test("with sign-in switched off, is told to ask the owner instead", () => {
    const html = render({ canSignIn: false });
    expect(html).not.toContain("signin-email");
    expect(html).toMatch(/ask whoever writes this journal/i);
  });
});

describe("a reader who is signed in and still refused", () => {
  const html = render({ signedInAs: "oma@example.test" });

  /** The assertion this state exists for. */
  test("is not shown the sign-in form again", () => {
    expect(html).not.toContain("signin-email");
    expect(html).not.toContain("signin-code");
  });

  test("is told it is this trip, not their sign-in, and by which address", () => {
    expect(html).toMatch(/not shared with you/i);
    expect(html).toContain("oma@example.test");
  });

  /** Not a dead end: the page that lists what this address *can* open, and
   * carries the control for signing out and trying another one. */
  test("is given somewhere to go", () => {
    expect(html).toContain("/alex/me");
    expect(html).toContain("/alex");
  });
});

/**
 * All three, because a reader who needs this page is the least likely to be
 * reading it in English — and a missing string renders as its own key, which
 * is exactly what a gate must not do.
 */
describe("every maintained locale", () => {
  test.each(MAINTAINED_LOCALES)("%s says all three things without leaking a key", (locale) => {
    for (const html of [
      render({ locale }),
      render({ locale, canSignIn: false }),
      render({ locale, signedInAs: "oma@example.test" }),
    ]) {
      expect(html).not.toContain("gate.");
      expect(html).not.toContain("me.signIn");
    }
  });
});

/** The keys the password form used are gone from every dictionary, not merely
 * unreferenced — an orphan reads as live copy to the next person editing. */
describe("the password copy", () => {
  test.each(MAINTAINED_LOCALES)("%s has no access.* or passwordChanged keys left", (locale) => {
    const keys = Object.keys(dictionaryFor(locale));
    expect(keys.filter((k) => k.startsWith("access."))).toEqual([]);
    expect(keys.filter((k) => k.includes("passwordChanged"))).toEqual([]);
  });
});
