import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import TripProvider from "@/components/TripProvider";
import { TripVisibility } from "@/components/Visibility";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1938 — D4's second door. `OwnerTools`' edit tile already deep-linked into
 * "Change a day" with the day chosen (B1831); the trip page's own visibility
 * control never gained the equivalent link into "Who may read this trip",
 * which is what this closes.
 */

function markup(owner: boolean) {
  const fixture = {
    id: "reise",
    username: "alex",
    visibility: "guest",
    listed: false,
  } as unknown as Parameters<typeof TripProvider>[0]["trip"];
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <TripProvider trip={fixture} isCurrent owner={owner}>
        <TripVisibility />
      </TripProvider>
    </LocaleProvider>,
  );
}

describe("the trip page's own visibility control — D4", () => {
  test("is a link into the studio flow, with this trip already chosen", () => {
    const html = markup(true);
    expect(html).toContain('href="/alex/studio/trip/visibility?trip=reise"');
  });

  test("renders nothing for anybody but the owner", () => {
    expect(markup(false)).toBe("");
  });
});
