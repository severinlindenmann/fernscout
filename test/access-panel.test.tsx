import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MePageContent, { type ManagePanel } from "@/app/[user]/me/MePageContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";
import type { Viewer } from "@/lib/viewer";
import { CODE_TTL_MINUTES } from "@/lib/auth";

/**
 * What the access panel offers a stranger.
 *
 * Once, two things: sign-in, and the open guestbook. B37 removed the second —
 * a form anybody who found a username could fill in, putting themselves on the
 * owner's queue uninvited. What is left is one door, and it is a capability: a
 * server ceiling and a journal opt-in, either of which can be shut.
 *
 * The rule is that a control is shown only when it can work, and when none
 * can, the page says so in a sentence instead — the sentence that used to
 * appear only on a journal with no guestbook, and is now simply true.
 */

// The panel renders the page header, which links and reads the path.
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/alex/me",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const site = {
  username: "alex",
  title: "Alex's journal",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: "/alex",
  hasAccessPanel: true,
} as unknown as SiteSummary;

const stranger: Viewer = { email: null, owner: false, guest: false, trips: [] };

const owner: Viewer = { email: "owner@example.test", owner: true, guest: false, trips: [] };

/** The same owner, with the journal's trips in the list — which is what
 * `resolveViewer` hands an owner, and what the buddy link needs to name. */
const ownerWithTrips: Viewer = {
  ...owner,
  trips: [
    { id: "bus-2026", title: "The bus year", href: "/alex/trips/bus-2026", through: "owner" },
  ],
};

function render(
  over: {
    canSignIn?: boolean;
    viewer?: Viewer;
    contactsEnabled?: boolean;
    /** `undefined` means the journal names nobody — see the B20 block below. */
    ownerName?: string;
    manage?: ManagePanel;
  } = {},
) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        {/* The panel draws the page header, which carries the currency and
            trip controls — so they need their providers even though nothing
            here asserts on them. */}
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
        <MePageContent
          viewer={over.viewer ?? stranger}
          username="alex"
          siteUrl="https://example.test"
          canSignIn={over.canSignIn ?? false}
          codeMinutes={CODE_TTL_MINUTES}
          contactsEnabled={over.contactsEnabled ?? false}
          ownerName={"ownerName" in over ? over.ownerName : "Robin"}
          manage={over.manage}
        />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("the access panel, for somebody not signed in", () => {
  /**
   * B37. The panel is the only place the open guestbook was ever advertised,
   * so this is the assertion that the signpost is down — whether or not the
   * journal keeps contacts, and whether or not it can issue codes.
   */
  test("never offers a way to join uninvited", () => {
    for (const canSignIn of [true, false]) {
      const html = render({ canSignIn });
      expect(html).not.toContain("/alex/join");
      // The button that opened it. ("guestbook" itself still appears, in the
      // sentence explaining that this journal does not keep one.)
      expect(html).not.toContain("Sign the guestbook");
      // And a stranger is never asked for what that form asked for. The
      // sign-in form is itself a form and wants an email address, so only the
      // postal fields separate the two.
      expect(html).not.toMatch(/postal|postcode|street/i);
    }
  });

  test("with sign-in available, offers the way back in", () => {
    expect(render({ canSignIn: true })).toContain("signin-email");
  });

  test("and nothing else: no second thing for a stranger to press", () => {
    const html = render({ canSignIn: true });
    expect(html).not.toMatch(/nothing to fill in/i);
  });

  test("without it, does not — the endpoints would answer 404", () => {
    expect(render({ canSignIn: false })).not.toContain("signin-email");
  });

  test("and then says why there is nothing to press", () => {
    expect(render({ canSignIn: false })).toMatch(/nothing to fill in/i);
  });
});

/**
 * The line beside each trip — the panel's whole claim about why this reader
 * may open that trip, and the reason the page exists.
 *
 * B80: `resolveViewer` had one arm for "owns the journal" and "was on the
 * trip", so the owner was told they had been on every trip in their own
 * journal — including one somebody else travelled and a `test: true` one
 * nobody did. The strings are asserted here rather than the key, because the
 * bug was a sentence a reader believed.
 */
describe("the reason beside each trip", () => {
  function seeing(through: Viewer["trips"][number]["through"], owner: boolean): string {
    const viewer: Viewer = {
      email: "reader@example.test",
      owner,
      guest: false,
      trips: [{ id: "t", title: "A trip", href: "/alex/trips/t", through }],
    };
    return render({ viewer });
  }

  test("an owner is told the journal is theirs, not that they were there", () => {
    const html = seeing("owner", true);
    expect(html).toContain("it is in your journal");
    expect(html).not.toContain("you were on this trip");
  });

  test("a traveller who is not the owner still reads that they were on it", () => {
    const html = seeing("traveller", false);
    expect(html).toContain("you were on this trip");
    expect(html).not.toContain("it is in your journal");
  });
});

/**
 * B74. The owner block ends in a link to the guest list, and that page is a
 * capability: `/<user>/contacts` calls `notFound()` when the journal has
 * contacts off. The link was drawn on ownership alone, so the owner of a
 * journal that never opened the door followed their own page into a 404 —
 * which teaches them the journal is unreliable, not that a feature is off.
 *
 * The rule is the same one the rest of this file tests: a control is shown
 * only when it can work, and when it cannot it is absent rather than broken.
 */
describe("the access panel, for the owner", () => {
  test("with contacts on, offers the guest list", () => {
    const html = render({ viewer: owner, contactsEnabled: true });
    expect(html).toContain('href="/alex/contacts"');
    expect(html).toContain("Manage who can read this");
  });

  test("with contacts off, does not — the page would answer 404", () => {
    const html = render({ viewer: owner, contactsEnabled: false });
    expect(html).not.toContain("/alex/contacts");
    expect(html).not.toContain("Manage who can read this");
  });

  test("and the rest of the owner block is untouched either way", () => {
    for (const contactsEnabled of [true, false]) {
      const html = render({ viewer: owner, contactsEnabled });
      // What an owner comes here for: the button that mints a prompt to hand
      // an agent (B301 — no address or email printed on the page any more).
      expect(html).toContain(dictionaryFor("en")["me.handoverCreate"]);
    }
  });
});


/**
 * B79 — the door for people, beside the door for agents.
 *
 * The panel could hand over the two lines an agent needs and nothing at all
 * for a person: inviting somebody meant a trip password that could not be
 * revoked for one of them, or opening `trip.md` in an editor. B33 built the
 * endpoint; these are the controls, and what they are asserted on is the
 * *copy*, because the mistake this feature can make is not a broken button.
 * It is an owner who reads "invite" twice, sends the wrong one to a group
 * chat, and finds out later that a buddy link leads to writing.
 */
/**
 * The way to the people, for the owner — B79, then B282.
 *
 * This page used to *make* a reading link and a writing link itself, and three
 * tests here asserted on those two blocks. They are gone, and so is
 * `components/InviteLinks.tsx`: the page could create a link and then could
 * not show it to you, because the URL appeared once and — until B280 made it
 * recoverable — was gone the moment the owner navigated away. Creation now
 * happens on `/{user}/contacts`, beside the list where a link is named,
 * revoked and copied, and `test/invite-panel.test.tsx` is where those
 * assertions live.
 *
 * What has to hold *here* is narrower and is what these tests check: one
 * control, leading there, and only for the owner.
 */
describe("the way to the people, for the owner", () => {
  test("offers one button to the page where links and readers live", () => {
    const html = render({ viewer: ownerWithTrips, contactsEnabled: true });
    expect(html).toContain("Inviting someone, and who reads along");
    expect(html).toContain('href="/alex/contacts"');
    // And still says the thing that stops a buddy link going in a group chat:
    // a link is an invitation to ask, not access.
    expect(html).toContain("Neither link lets anybody in on its own");
  });

  test("makes no link itself, so nothing here produces a URL it cannot show", () => {
    const html = render({ viewer: ownerWithTrips, contactsEnabled: true });
    expect(html).not.toContain('id="invite-trip"');
    expect(html).not.toContain("Create a reading link");
    // The two descriptions moved to the contacts panel with the controls they
    // belong to; neither should be duplicated here.
    expect(html).not.toContain("Do not put this one in a group chat.");
  });

  test("a journal with no trips gets the same one control", () => {
    const html = render({ viewer: owner, contactsEnabled: true });
    expect(html).toContain('href="/alex/contacts"');
  });

  test("with contacts off, the control is absent — the page answers 404", () => {
    const html = render({ viewer: ownerWithTrips, contactsEnabled: false });
    expect(html).not.toContain("Inviting someone, and who reads along");
    expect(html).not.toContain('href="/alex/contacts"');
  });

  /**
   * Nobody else, at all. A guest of the journal and a traveller on a trip are
   * both signed in and both have a legitimate reason to be on this page; the
   * ability to hand out access is the owner's alone, which is the same line
   * `isOwner` draws on the endpoint.
   */
  test("and nobody but the owner sees any of it", () => {
    const others: Viewer[] = [
      stranger,
      { email: "guest@example.test", owner: false, guest: true, trips: [] },
      {
        email: "buddy@example.test",
        owner: false,
        guest: false,
        trips: [
          { id: "bus-2026", title: "The bus year", href: "/alex/trips/bus-2026", through: "traveller" },
        ],
      },
    ];
    for (const viewer of others) {
      const html = render({ viewer, contactsEnabled: true });
      expect(html).not.toContain("Invite somebody");
      expect(html).not.toContain("A link for someone to read");
      expect(html).not.toContain("A link for someone to write");
      expect(html).not.toContain('id="invite-trip"');
    }
  });
});

/**
 * B20 — "ask them" — ask whom?
 *
 * The stranger's half of this page is the one written for the reader least
 * comfortable with software on the site: somebody who opens the journal once a
 * month from a link in an email and, when she loses the email, has no way back
 * in. It told her that the only way in is to ask a person, and never said
 * which person, on a site she may have reached without knowing whose it is.
 *
 * The name and nothing else. `owner.email` is one property away in the same
 * config object, which is why the field is picked at the server boundary
 * (`ownerShortName`) rather than handed over whole and chosen from here — and
 * why the assertion below is that the address is nowhere in the markup rather
 * than that nobody wrote the JSX for it.
 */
describe("who a stranger is told to ask", () => {
  test("names the owner, whether or not there is a sign-in form", () => {
    for (const canSignIn of [true, false]) {
      const html = render({ canSignIn, ownerName: "Robin" });
      expect(html, `canSignIn=${canSignIn}`).toContain("Robin");
    }
  });

  test("and says it in the sentence about asking, not only in passing", () => {
    expect(render({ canSignIn: true, ownerName: "Robin" })).toContain("ask Robin to invite you");
    expect(render({ canSignIn: false, ownerName: "Robin" })).toContain(
      "the link Robin sends you is what lets you in",
    );
  });

  test("never an address, a number or a way to reach them off this site", () => {
    for (const canSignIn of [true, false]) {
      const html = render({ canSignIn, ownerName: "Robin" });
      expect(html).not.toContain("owner@example.test");
      expect(html).not.toMatch(/mailto:/);
      expect(html).not.toMatch(/@example/);
    }
  });

  test("a journal that names nobody keeps the sentences that name nobody", () => {
    // Not "Ask ." — a config with no owner name in it is malformed, and the
    // page falls back rather than rendering a hole.
    const html = render({ canSignIn: false, ownerName: undefined });
    expect(html).toMatch(/nothing to fill in/i);
    expect(html).not.toMatch(/Ask \./);
  });
});

/**
 * The "Your details" panel, inline (B304).
 *
 * It used to be a `Link` to `/{user}/c/{token}` — the same form on a second
 * page, reached with no session lost in the navigation. It is now the same
 * `ContactManage` component, mounted in place inside a `<details>`, because a
 * reader who is already signed in landed on a second page for one field they
 * could see right in front of them — and, since the page around it renders in
 * whatever language this reader chose, a header in one language above a form
 * in another (`/{user}/c/{token}`'s own, deliberate, record-language design)
 * read as broken here rather than intentional.
 */
describe("the details panel, inline", () => {
  const manage: ManagePanel = {
    token: "fs_manage_test",
    locales: ["en", "de"],
    // Deliberately not "en" — the page around it (`render()`, above) is
    // fixed to English. A German panel inside an English page is exactly
    // what proves the two are wired independently: the reader's own choice
    // for the chrome, the record's for nothing here any more (B304 moved
    // that decision out of `/{user}/c/{token}` and into the page's own
    // language, which the caller now hands down as `manage.dictionary`).
    dictionary: dictionaryFor("de"),
    contact: {
      name: "Fam. Peter",
      email: "peter@example.test",
      locale: "en",
      status: "active",
      wantsEmailDigest: true,
      wantsPostcard: false,
      address: { name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "" },
    },
  };

  test("absent with no contact record — no dead link to a page that has nothing", () => {
    const html = render({ viewer: owner, contactsEnabled: true });
    expect(html).not.toContain("<details");
    expect(html).not.toContain(dictionaryFor("en")["me.editDetails"]);
  });

  test("offers the toggle, and no more a link to /c/<token>", () => {
    const html = render({ viewer: owner, contactsEnabled: true, manage });
    expect(html).toContain("<details");
    expect(html).toContain(dictionaryFor("en")["me.editDetails"]);
    expect(html).not.toMatch(/href="\/alex\/c\//);
  });

  test("renders the form in its own dictionary, independent of the page's", () => {
    const html = render({ viewer: owner, contactsEnabled: true, manage });
    // The page around it stayed English (`me.details`, from `render()`'s
    // fixed `LocaleProvider`) while the form inside it is the German
    // `manage.dictionary` — both present at once, proving one does not leak
    // into or override the other. `contact.name` rather than
    // `contact.manageTitle`: the latter happens to read "Your details" in
    // English too — the same string `me.details` already put on the page —
    // so it can't tell "the form went German" apart from "it never left
    // English" the way a label with no such coincidence can.
    expect(html).toContain(dictionaryFor("en")["me.details"]);
    expect(html).toContain(dictionaryFor("de")["contact.name"]);
    expect(html).not.toContain(`>${dictionaryFor("en")["contact.name"]}<`);
  });

  test("hands the contact's own data to the form, not a blank one", () => {
    const html = render({ viewer: owner, contactsEnabled: true, manage });
    expect(html).toContain('value="Fam. Peter"');
  });
});

/**
 * B320 — the buddy's half of the page.
 *
 * Somebody named in a trip's `people:`, or approved through a buddy link
 * (B33), may write days into that trip and may hold a token scoped to it —
 * `AGENTS.md` says so, and `mayRequestAgentToken` in `/api/auth/request`
 * enforces it. Nothing they could reach said it. Every sentence on this page
 * about writing sat inside `{viewer.owner && …}`, and the details panel beside
 * it told them the journal was written by an agent and nothing here could be
 * edited — which reads as a closed door to one of the people that agent writes
 * for.
 *
 * The assertions are on the *copy* and on the *prompt*, not on a credential:
 * the failure this block exists to prevent is a person concluding they have no
 * write access, and the failure it could newly cause is a prompt that names
 * the wrong trip.
 */
describe("what somebody on a trip is told they can write", () => {
  const buddy: Viewer = {
    email: "kevin@example.test",
    owner: false,
    guest: true,
    trips: [
      { id: "asia-2025", title: "Asia 2025", href: "/alex/trips/asia-2025", through: "traveller" },
      // Readable, not writable — a public trip they were not on. It must not
      // acquire a prompt merely by being in the list.
      { id: "open-road", title: "Open road", href: "/alex/trips/open-road", through: "public" },
    ],
  };

  const guestOnly: Viewer = {
    email: "gran@example.test",
    owner: false,
    guest: true,
    trips: [
      { id: "asia-2025", title: "Asia 2025", href: "/alex/trips/asia-2025", through: "guest" },
    ],
  };

  /** Enough of one for the details panel to render; the panel's own behaviour
   * is tested above and what matters here is which sentence sits over it. */
  const record: ManagePanel = {
    token: "fs_manage_test",
    locales: ["en"],
    dictionary: dictionaryFor("en"),
    contact: {
      name: "Kevin",
      email: "kevin@example.test",
      locale: "en",
      status: "active",
      wantsEmailDigest: true,
      wantsPostcard: false,
      address: { name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "" },
    },
  };

  test("is told at all, which is the whole of the bug", () => {
    const html = render({ viewer: buddy });
    expect(html).toContain(dictionaryFor("en")["me.buddyTitle"]);
    // A fragment rather than the whole string: the sentence contains an
    // apostrophe, and `renderToStaticMarkup` escapes it to `&#x27;`.
    expect(html).toContain("You were on the trip, so you can add days to it");
  });

  test("gets a prompt naming the trip they were on, and only that trip", () => {
    const html = render({ viewer: buddy });
    expect(html).toContain("https://example.test/alex/trips/asia-2025");
    expect(html).toContain("&quot;trip&quot;:&quot;asia-2025&quot;");
    // The public trip is readable and not writable, so it belongs in the list
    // above and in no prompt — a code request for it is one the server
    // refuses, with nothing on the page to explain why. Asserted on the
    // request body and on the per-trip heading rather than on the bare id,
    // which is legitimately in the markup as a link to the trip itself.
    expect(html).not.toContain("&quot;trip&quot;:&quot;open-road&quot;");
    expect(html).not.toContain("For Open road");
  });

  test("the prompt asks for a code for their own address and nobody else's", () => {
    const html = render({ viewer: buddy });
    expect(html).toContain("kevin@example.test");
    expect(html).toContain("/api/auth/request");
    expect(html).toContain("/api/auth/verify");
  });

  /**
   * The limit is the point. A buddy's token cannot publish — that call is the
   * owner's (B28) — and an agent that does not know will read the refusal as a
   * fault and go looking for a way round it, which is how B293's invented "web
   * UI" happened.
   */
  test("and says what the key cannot do, in the prompt and on the page", () => {
    const html = render({ viewer: buddy });
    expect(html).toContain("stays a draft");
    expect(html).toContain(dictionaryFor("en")["me.buddyKeyBody"]);
  });

  test("no longer reads that nothing here can be edited", () => {
    const html = render({ viewer: buddy, contactsEnabled: true, manage: record });
    expect(html).toContain(dictionaryFor("en")["me.detailsBodyTraveller"]);
    expect(html).not.toContain(dictionaryFor("en")["me.detailsBody"]);
  });

  test("a guest of the journal gets none of it, and the sentence is unchanged", () => {
    const html = render({ viewer: guestOnly, contactsEnabled: true, manage: record });
    expect(html).not.toContain(dictionaryFor("en")["me.buddyTitle"]);
    expect(html).not.toContain("/api/auth/verify");
    expect(html).toContain(dictionaryFor("en")["me.detailsBody"]);
  });

  test("and neither does a stranger, who has no address to ask for a code with", () => {
    const html = render({ viewer: stranger, canSignIn: true });
    expect(html).not.toContain(dictionaryFor("en")["me.buddyTitle"]);
    expect(html).not.toContain("/api/auth/verify");
  });

  /**
   * An owner who also travelled has `traveller` trips in this list. Offering
   * them the mail-a-code flow beside their own button is two ways to do one
   * job for a reader with no basis for choosing — which is what B301 removed
   * from the owner block, and it must not come back through this door.
   */
  test("an owner who was on the trip keeps their own button and gets no second flow", () => {
    const html = render({
      viewer: { ...owner, trips: [...buddy.trips] },
      contactsEnabled: true,
    });
    expect(html).toContain(dictionaryFor("en")["me.handoverCreate"]);
    expect(html).not.toContain(dictionaryFor("en")["me.buddyTitle"]);
    expect(html).not.toContain("/api/auth/verify");
  });
});
