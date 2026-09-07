import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentWizard from "@/components/AgentWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { TripGap, WizardTrip } from "@/lib/helper/server";

/**
 * The date the wizard opens on — B818, and the gap line — B819.
 *
 * The field defaulted to today whoever sent somebody here, including a link
 * that said "Finish Wednesday, 19 August" in so many words: a person tidying
 * up three weeks after a trip filled the form on autopilot and dated their day
 * to the afternoon they were tidying. A static render is the whole test — what
 * is in the box on the first render is what a person on autopilot publishes.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function render(
  trips: WizardTrip[],
  open?: { date?: string; trip?: string; slug?: string },
  gaps: TripGap | null = null,
) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <AgentWizard
        username="alex"
        trips={trips}
        drafts={[]}
        currency={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}
        open={open}
        gaps={gaps}
        helper={{
          enabled: false,
          consented: false,
          consentedPhotos: false,
          credits: 1,
          speech: false,
          consentedSpeech: false,
          speechProvider: "dry-run",
        }}
      />
    </LocaleProvider>,
  );
}

/** A trip that ended long ago, so today is inside nothing. */
const over: WizardTrip = { id: "alps", title: "The Alps", start: "2026-08-14", end: "2026-08-21" };
/** One that is running, whenever this test happens to be run. */
const running: WizardTrip = { id: "now", title: "Now", start: "2000-01-01", end: "2999-12-31" };

describe("which day the wizard offers", () => {
  test("the date the opening link names, not today", () => {
    const html = render([over], { date: "2026-08-19", trip: "alps" });
    expect(html).toContain('value="2026-08-19"');
    expect(html).not.toContain(`value="${today()}"`);
  });

  test("a link's date beats a running trip, and opens the long path", () => {
    const html = render([running, over], { date: "2026-08-19", trip: "alps" });
    // The express path guesses today; a link that named a day has already
    // answered the question, so the trip and date screen is what opens.
    expect(html).toContain('id="wizard-date"');
    expect(html).toContain('value="2026-08-19"');
  });

  test("with no link and no trip running, the oldest unwritten day", () => {
    const html = render([over], undefined, {
      trip: "alps",
      title: "The Alps",
      total: 8,
      missing: ["2026-08-20", "2026-08-21"],
    });
    expect(html).toContain('value="2026-08-20"');
  });

  test("today, when today is inside a running trip", () => {
    const html = render([running]);
    // The express path: today, and it says which day it is going to.
    expect(html).toContain('id="wizard-prose"');
  });
});

describe("the days nobody wrote", () => {
  test("said once, with each date a tap and a way to be rid of it", () => {
    const html = render([over], undefined, {
      trip: "alps",
      title: "The Alps",
      total: 8,
      missing: ["2026-08-20", "2026-08-21"],
    });
    expect(html).toContain("The Alps ran 8 days, and 2 of them were never written.");
    expect(html).toContain("Don&#x27;t show this again");
  });

  test("nothing at all when there is no gap", () => {
    const html = render([over]);
    expect(html).not.toContain("were never written");
  });
});
