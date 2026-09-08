import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import EditDay from "@/components/EditDay";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day } from "@/lib/types";

/**
 * B862 — a photograph the owner already marked from the lightbox arrives at
 * `EditDay` pre-selected, so the panel opens showing exactly what is about to
 * go rather than an owner having to find the same photograph a second time
 * among the thumbnails. This is the whole of what `initialDrop` does: it
 * seeds the same `dropping` state a press of "Remove" here would, so nothing
 * downstream (Save, the confirm-by-dimming-and-"Keep after all" pattern) has
 * to know where the mark came from.
 */

const day: Day = {
  date: "2026-09-01",
  entries: [
    {
      slug: "erster-tag",
      title: "Erster Tag",
      date: "2026-09-01",
      location: "Bellinzona",
      country: "Switzerland",
      lat: 46.1944,
      lng: 9.0175,
      gallery: [
        { src: "/alex/media/reise/erster-tag/01.jpg", type: "image" },
        { src: "/alex/media/reise/erster-tag/02.jpg", type: "image" },
      ],
      tags: [],
      costs: [],
      content: "Ankunft.",
    } as unknown as Day["entries"][number],
  ],
} as unknown as Day;
day.lead = day.entries[0];

function render(initialDrop?: string) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <EditDay
        username="alex"
        tripId="reise"
        day={day}
        initialDrop={initialDrop}
        onClose={() => {}}
      />
    </LocaleProvider>,
  );
}

describe("EditDay opened with a photograph already marked", () => {
  test("with no initialDrop, both photos still offer to be removed", () => {
    const html = render();
    expect(html.match(/>Remove</g)?.length).toBe(2);
    expect(html).not.toContain(">Keep after all<");
  });

  test("the named photograph starts marked to go, the other does not", () => {
    const html = render("/alex/media/reise/erster-tag/01.jpg");
    // One tile offers to undo the mark…
    expect(html.match(/>Keep after all</g)?.length).toBe(1);
    // …and the other still offers to make it.
    expect(html.match(/>Remove</g)?.length).toBe(1);
  });
});
