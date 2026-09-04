import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LifetimeMap, { type TripRoute } from "@/components/LifetimeMap";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B265. `app/[user]/trips/page.tsx` builds each route's `points` straight
 * from `getPlaces`, which returns a `Place` for a day with no coordinates too
 * (`lat`/`lng` are optional on an entry). That page is frozen mid-rewrite by
 * another session, so the guard against drawing one of those places as a
 * point on the lifetime map has to live here instead — this is the only
 * component between the raw list and the SVG.
 */

const alps: TripRoute["points"] = [
  { lat: 46.1161, lng: 8.2939, location: "Domodossola" },
  { lat: 46.5614, lng: 8.3372, location: "Grimsel" },
  { lat: 46.7297, lng: 8.4444, location: "Susten" },
];

function render(routes: TripRoute[]) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <LifetimeMap routes={routes} />
    </LocaleProvider>,
  );
}

describe("a trip with a day that has no coordinates", () => {
  const route: TripRoute = {
    id: "alps-2024",
    title: "Alps 2024",
    accent: "sky",
    points: [...alps, { lat: undefined as unknown as number, lng: undefined as unknown as number, location: "Unrecorded" }],
  };

  test("does not put NaN through the lifetime map", () => {
    expect(render([route])).not.toContain("NaN");
  });

  test("a route with nothing plottable still renders the whole world, not NaN", () => {
    const empty: TripRoute = {
      id: "planned-only",
      title: "Planned only",
      accent: "coral",
      points: [{ lat: undefined as unknown as number, lng: undefined as unknown as number, location: "Nowhere yet" }],
    };
    expect(render([route, empty])).not.toContain("NaN");
  });
});
