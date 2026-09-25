import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import TripProvider from "@/components/TripProvider";
import { EntryVisibility } from "@/components/Visibility";
import { dictionaryFor } from "@/lib/locales";
import type { PhotoVisibility } from "@/lib/photos";
import type { Trip, TripVisibility } from "@/lib/types";

/**
 * B632, then B1585 — the sibling of `test/photo-visibility-marker.test.tsx`.
 *
 * B632's half is unchanged and is the first three cases: a held-back update
 * says so to the one audience allowed to notice, and to nobody else.
 * `visible()` in lib/entries.ts is what makes the entry *absent* below its
 * level (covered by `test/entry-visibility.test.ts`); this is the marker for
 * a reader who may see the update at all.
 *
 * B1585 added the owner's half, and it is the one worth guarding: for the
 * owner the badge is never absent, and it says the **effective** audience
 * rather than the field. Absence used to mean either "nothing set here" or
 * "on the open internet", and the owner had no way to tell which.
 */

function markup({
  visibility,
  reader,
  owner = false,
  trip = "public",
}: {
  visibility?: PhotoVisibility;
  reader: "public" | "guest" | "person";
  owner?: boolean;
  trip?: TripVisibility;
}) {
  const fixture = {
    id: "reise",
    username: "alex",
    visibility: trip,
    listed: true,
  } as unknown as Trip;
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <TripProvider trip={fixture} isCurrent reader={reader} owner={owner}>
        <EntryVisibility entry={{ slug: "a-day", visibility }} />
      </TripProvider>
    </LocaleProvider>,
  );
}

describe("a held-back update, as the badge draws it", () => {
  test("nothing renders for an unlabelled update, at any reader level", () => {
    expect(markup({ reader: "person" })).not.toContain("Private");
    expect(markup({ reader: "person" })).not.toContain("Guest");
  });

  test("nothing renders below person level — a guest reader sees no marker on their own update", () => {
    expect(markup({ visibility: "guest", reader: "public" })).toBe("");
    expect(markup({ visibility: "guest", reader: "guest" })).toBe("");
  });

  test("a traveller who is not the owner sees the marker, matching the label", () => {
    expect(markup({ visibility: "guest", reader: "person" })).toContain("Guests");
    expect(markup({ visibility: "private", reader: "person" })).toContain("Private");
  });
});

describe("the owner's own badge — B1585", () => {
  // The ticket, in one assertion. An update inheriting a public trip used to
  // render nothing at all, which reads as "no setting" and is in fact "on the
  // open internet".
  test("an update with no label of its own still says what it is", () => {
    expect(markup({ reader: "person", owner: true, trip: "public" })).toContain("Public");
    expect(markup({ reader: "person", owner: true, trip: "guest" })).toContain("Guests");
  });

  test("its own label narrows the word", () => {
    expect(
      markup({ visibility: "private", reader: "person", owner: true, trip: "public" }),
    ).toContain("Private");
  });

  /**
   * A label narrows and never widens (lib/photos.ts). A badge saying "Guests"
   * on a private trip would be telling the owner that a day is readable by
   * people the trip refuses.
   */
  test("a guest label inside a private trip still reads private", () => {
    const html = markup({ visibility: "guest", reader: "person", owner: true, trip: "private" });
    // The badge only — the `?` beside it names all three words by design, so
    // asserting over the whole markup would be asserting about the explainer.
    const badge = html.slice(0, html.indexOf("<details"));
    expect(badge).toContain("Private");
    expect(badge).not.toContain("Guests");
  });

  test("the badge is a control for the owner and a plain label for everybody else", () => {
    expect(markup({ visibility: "private", reader: "person", owner: true })).toContain("<button");
    expect(markup({ visibility: "private", reader: "person" })).not.toContain("<button");
  });
});
