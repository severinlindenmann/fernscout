import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import GalleryPageContent from "@/app/[user]/(trip)/gallery/GalleryPageContent";
import { openingOf, photoPathOf } from "@/components/PostcardSheet";
import { dictionaryFor } from "@/lib/locales";
import type { MediaTile } from "@/lib/types";

/**
 * B441 — the postcard control on a page every reader can see.
 *
 * The gallery is behind `mayReadTrip`, which on a public trip is everybody and
 * on a `guest` trip is every approved reader. So the property worth a test is
 * not that the button works; it is that **it is not there** for anybody but the
 * owner, and absent rather than disabled — a control that only tells a guest no
 * is a control that should not have rendered.
 *
 * The server decides, in `page.tsx`, by handing down a `postcard` prop or not.
 * These render the component both ways and read the markup, which is how every
 * other component test here works — there is no testing-library in this
 * repository, so nothing below clicks anything.
 *
 * The routes the sheet calls do not trust any of this: `POST …/postcards` and
 * `GET …/postcards/recipients` each ask `isOwner` themselves. This is about
 * what a reader is *shown*.
 *
 * `PageHeader` is stubbed because it wants `SiteProvider` and `TripProvider`
 * around it, and standing a whole journal up to read one button would make the
 * fixture the thing most likely to break. It is not what is under test — the
 * same reasoning `test/contacts-way-back.test.tsx` applies to its own mocks.
 */

vi.mock("@/components/PageHeader", () => ({ default: () => null }));

function tile(n: number): MediaTile {
  return {
    src: `/alex/media/alps-2024/day-${n}/01.jpg`,
    slug: `2026-08-0${n}-a-day`,
    type: "image",
    location: "Zermatt",
    country: "Switzerland",
    date: `2026-08-0${n}`,
  };
}

function markup(postcard?: { username: string; trip: string; from: string }) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <GalleryPageContent media={[tile(1), tile(2)]} places={[]} postcard={postcard} />
    </LocaleProvider>,
  );
}

const OWNER = { username: "alex", trip: "alps-2024", from: "Alex" };

describe("who is offered a postcard", () => {
  test("a reader is shown nothing at all — not a disabled button", () => {
    const html = markup(undefined);
    expect(html).not.toContain("Send a postcard");
    // Nor any other part of the flow leaking into a reader's page.
    expect(html).not.toContain("postcard");
    expect(html).not.toContain("Choose a photograph");
  });

  test("the slideshow is still there for that reader", () => {
    // The guard must not have removed the control this page already had.
    expect(markup(undefined)).toContain("Slideshow");
  });

  test("the owner gets the button, beside the slideshow", () => {
    const html = markup(OWNER);
    expect(html).toContain("Send a postcard");
    expect(html).toContain("Slideshow");
  });

  test("nothing in the owner's own markup carries an address", () => {
    // Recipients are fetched only when the sheet opens, and the sheet is not
    // open. A gallery page that shipped the contact list to every render would
    // be putting home addresses in a page cache.
    const html = markup(OWNER);
    expect(html).not.toContain("contactId");
  });
});

describe("the message the sheet starts from", () => {
  test("frontmatter, headings and image lines are not the message", () => {
    const text = openingOf(
      ["---", "title: Over the pass", "date: 2026-08-01", "---", "", "# Over the pass", "", "![](01.jpg)", "", "It rained the whole way up."].join("\n"),
    );
    expect(text).toBe("It rained the whole way up.");
  });

  test("a long day is cut at a sentence, never mid-word", () => {
    const day = "One sentence here. " + "Another sentence that goes on. ".repeat(20);
    const text = openingOf(day, 100);
    expect(text.length).toBeLessThanOrEqual(100);
    // A card that opens mid-word looks like a bug in the box the owner is
    // about to edit.
    expect(text.endsWith(".")).toBe(true);
  });

  test("a day with no prose at all yields an empty box, not a crash", () => {
    expect(openingOf("---\ntitle: x\n---\n")).toBe("");
  });
});

describe("the photo path an order is given", () => {
  test("the media URL is reduced to a path inside the trip", () => {
    expect(photoPathOf("/alex/media/alps-2024/day-1/01.jpg", "alex", "alps-2024")).toBe(
      "day-1/01.jpg",
    );
  });

  test("a URL of an unexpected shape is passed through, to be refused by name", () => {
    // Not silently reshaped into something plausible: the server checks the
    // photo is in the trip, and a wrong string should fail there loudly rather
    // than resolve to a different file here quietly.
    const odd = "https://elsewhere.test/photo.jpg";
    expect(photoPathOf(odd, "alex", "alps-2024")).toBe(odd);
  });
});
