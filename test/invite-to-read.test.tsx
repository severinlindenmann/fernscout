import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import { DayCard } from "@/components/StoryPager";
import TripProvider from "@/components/TripProvider";
import { dictionaryFor } from "@/lib/locales";
import type { Day, DaySummary, Trip } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * B799 — the offer to show a day to somebody, on the day itself.
 *
 * B2295: this used to make a guest link itself; it is now a plain link to
 * `/<user>/studio/readers`, the one place the owner decided a person is let
 * in. Read from the source rather than rendered — same reason as before,
 * kept simple now that there is no fetch to avoid running.
 */

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "components/InviteToRead.tsx"), "utf8");

describe("the share control on a day", () => {
  test("is a plain link to Studio › Readers, not a form of its own", () => {
    expect(source).toContain("/studio/readers");
    expect(source, "no invite link is minted here any more").not.toMatch(/fetch\(/);
  });

  test("is on the day she just published, and on the trip page", () => {
    // Both render it through `OwnerTools` since B877 — one block, so a fifth
    // control lands in one place rather than being added twice in two styles.
    const tools = fs.readFileSync(path.join(root, "components/OwnerTools.tsx"), "utf8");
    expect(tools).toContain("<InviteToRead");

    const trip = fs.readFileSync(path.join(root, "app/TripStory.tsx"), "utf8");
    // Only for somebody who could have published it. `canPublish` is exactly
    // `isOwner` — see `lib/tripGate.ts`. The trip overview reads the gate and
    // the block right beside each other in one short function, so a
    // character-window proximity check is still an honest stand-in for "no
    // second gate reopens it" there.
    expect(trip).toMatch(/trip\?\.canPublish[\s\S]{0,80}<OwnerTools/);
  });
});

/**
 * B1142 — the day card's own gate, checked by rendering rather than by
 * measuring how many characters sit between two markers in the source.
 *
 * The day branch of `StoryPager.tsx` puts `EditDay` between the `canPublish`
 * check and `<OwnerTools>` (B980), and later widened `EditDay`'s own props
 * (B980 round 3) — both honest changes that pushed the two markers further
 * apart in the text, which is exactly why a character-window assertion on
 * this file kept needing to be loosened. The actual claim, "nothing between
 * the gate and the block reopens it for a reader who is not the owner", is a
 * fact about what renders, not about how far apart two strings sit — so it is
 * asserted by rendering `DayCard` for an owner and for a non-owner and
 * checking `OwnerTools`' own marker (`owner.onlyYou`, its `aria-label` and
 * its heading) is present for one and absent for the other.
 */
function renderDayCard(canPublish: boolean): string {
  const day: Day = {
    date: "2026-05-04",
    entries: [
      {
        slug: "fixture",
        title: "A day on the fixture road",
        date: "2026-05-04",
        location: "Somewhere",
        country: "Nowhere",
        lat: 46.8,
        lng: 8.2,
        gallery: [],
        tags: [],
        costs: [],
        content: "Nothing much happened, which was the point.",
      } as unknown as Day["entries"][number],
    ],
  } as unknown as Day;
  day.lead = day.entries[0];

  const summary: DaySummary = {
    date: "2026-05-04",
    slug: "fixture",
    location: "Somewhere",
    country: "Nowhere",
    updates: 1,
    cost: 0,
  } as unknown as DaySummary;

  const trip = {
    id: "fixture",
    ref: "alex/fixture",
    username: "alex",
    title: "Fixture trip",
    visibility: "public",
  } as unknown as Trip;

  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
        <TripProvider trip={trip} isCurrent canPublish={canPublish}>
          <DayCard day={day} summary={summary} dayIndex={0} />
        </TripProvider>
      </CurrencyProvider>
    </LocaleProvider>,
  );
}

describe("the day card's owner-only block", () => {
  test("renders for the owner", () => {
    const html = renderDayCard(true);
    expect(html).toContain("Only you can see this");
  });

  test("is absent for a reader who cannot publish", () => {
    const html = renderDayCard(false);
    expect(html).not.toContain("Only you can see this");
  });
});
