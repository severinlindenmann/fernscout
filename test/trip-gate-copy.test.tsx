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

  /**
   * B117, and the reason the `<h1>` is the journal's name rather than the
   * trip's.
   *
   * The gate used to head the page with the trip's own title. It read well —
   * "sign in to see *Honeymoon, Kerala*" is kinder than "sign in to see
   * something" — but the reader it was written for is not the only one who
   * gets it. Trip ids are chosen by hand and guessable by construction
   * (`alps-2024`, `japan-2027`), the journal name is public, and a private
   * trip's title is often the sensitive part of it.
   *
   * What settled it is one line up: a reader who signs in and is *still*
   * refused has never been shown the title. The site was naming the trip only
   * to whoever had proved nothing at all.
   *
   * The journal's name stays, because it is already public and it is what
   * tells a reader whose sign-in form this is. Somebody who followed a buddy
   * or guest link still learns the trip's name from the invitation page, which
   * takes a token — see `components/InviteRedeem.tsx`.
   */
  test("is told whose journal it is, and never which trip", () => {
    expect(render()).toContain("Alex&#x27;s journal");
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

/**
 * The gate as the layout actually mounts it — the `<h1>` half of B117.
 *
 * Asserting on `TripGate` alone cannot prove this: once the prop is gone the
 * component has nothing to leak, and the test passes for the wrong reason. The
 * question is whether the *layout*, which holds the trip and therefore its
 * title, hands it over. So this renders the shipped layout for a refused trip
 * with a title no other string in the page resembles, and looks for it.
 */
describe("the layout that draws the gate", () => {
  const SECRET = "Divorce trip 2026";

  test("hands the gate no trip title, so an anonymous reader sees none", async () => {
    vi.doMock("@/lib/tripGate", () => ({
      mayReadTrip: async () => false,
      signedInAs: async () => null,
    }));
    vi.doMock("@/lib/trips", () => ({
      tripRef: (user: string, id: string) => `${user}/${id}`,
      getTrip: () => ({
        id: "secret-2026",
        ref: "alex/secret-2026",
        username: "alex",
        title: SECRET,
        visibility: "private",
        listed: false,
      }),
    }));
    vi.doMock("@/lib/users", () => ({ getUser: () => ({ title: "Alex journal" }) }));
    vi.doMock("@/lib/capabilities", () => ({ isEnabled: () => true }));
    vi.resetModules();

    const { default: TripLayout } = await import("@/app/[user]/trips/[trip]/layout");
    const tree = await TripLayout({
      children: <p>the trip itself</p>,
      params: Promise.resolve({ user: "alex", trip: "secret-2026" }),
    } as never);

    // From the same module graph the layout just pulled `TripGate` out of:
    // `resetModules` gave it a fresh React context, and the copy imported at
    // the top of this file is no longer the one it reads.
    const { default: Provider } = await import("@/components/LocaleProvider");
    const html = renderToStaticMarkup(
      <Provider locale="en" dictionary={dictionaryFor("en")}>
        {tree}
      </Provider>,
    );

    // The gate is what rendered, not the trip.
    expect(html).not.toContain("the trip itself");
    expect(html).toContain("signin-email");

    // And it names the journal, not the trip. Both spellings of the trip's
    // title, because React escapes what it prints.
    expect(html).not.toContain(SECRET);
    expect(html).not.toMatch(/divorce/i);
    expect(html).toContain("Alex journal");

    vi.doUnmock("@/lib/tripGate");
    vi.doUnmock("@/lib/trips");
    vi.doUnmock("@/lib/users");
    vi.doUnmock("@/lib/capabilities");
    vi.resetModules();
  });
});
