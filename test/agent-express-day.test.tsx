import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentWizard, { PICKER_ACCEPT } from "@/components/AgentWizard";
import LocaleProvider from "@/components/LocaleProvider";
import { INBOX_FILE_EXTENSIONS } from "@/lib/inbox";
import { dictionaryFor } from "@/lib/locales";
import type { WizardDraft } from "@/lib/helper/draft";
import type { WizardTrip } from "@/lib/helper/server";

/**
 * The ordinary day, counted — B780, and the picker that stopped refusing —
 * B791.
 *
 * A tap count is the thing this ticket is actually about and the thing no
 * assertion can measure directly. What a static render *can* say is which
 * screen opens: every control between `/agent/<user>` and the words is a tap,
 * so a first render that already carries the prose box and carries no trip
 * select is three taps saved, and a first render that carries the trip select
 * is the long path still being there. That is the closest thing to a tap
 * count, and it is what stops this regressing.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function trip(id: string, start: string, end: string): WizardTrip {
  return { id, title: `Die Reise ${id}`, start, end };
}

/** A trip that is running right now — the whole test of the express path. */
function running(id = "alpen"): WizardTrip {
  return trip(id, "2000-01-01", "2999-12-31");
}

function render(trips: WizardTrip[], drafts: WizardDraft[] = []) {
  return renderToStaticMarkup(
    <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
      <AgentWizard
        username="alex"
        trips={trips}
        drafts={drafts}
        currency={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}
        helper={{
          enabled: false,
          consented: false,
          consentedPhotos: false,
          credits: 1,
          speech: true,
          consentedSpeech: true,
          speechProvider: "dry-run",
        }}
      />
    </LocaleProvider>,
  );
}

describe("the express path", () => {
  test("one running trip and today opens on the words, not on the questions", () => {
    const html = render([running()]);
    // The words are there to be written the moment the screen arrives.
    expect(html).toContain('id="wizard-prose"');
    // And neither question is standing in front of them.
    expect(html).not.toContain('id="wizard-trip"');
    expect(html).not.toContain('id="wizard-date"');
    // Hold to talk — the second of the three taps.
    expect(html).toContain("Zum Sprechen halten");
  });

  test("it says out loud which trip and which day, with a way to change both", () => {
    const html = render([running()]);
    expect(html).toContain("Kommt zu Die Reise alpen");
    expect(html).toContain("ändern");
  });

  test("the title is filled in, so nothing empty stands between a person and saving", () => {
    const html = render([running()]);
    const weekday = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"][
      new Date(`${today()}T00:00:00Z`).getUTCDay()
    ];
    expect(html).toContain(`value="${weekday}"`);
  });

  test("photographs are offered on that same screen rather than standing in the way", () => {
    const html = render([running()]);
    expect(html).toContain('id="wizard-quick-pick"');
  });

  test("two trips running today is a question only a person can answer", () => {
    const html = render([running("alpen"), running("jura")]);
    expect(html).toContain('id="wizard-trip"');
    expect(html).not.toContain('id="wizard-prose"');
  });

  test("no trip covering today is the long path too", () => {
    const html = render([trip("alt", "2001-01-01", "2001-01-09")]);
    expect(html).toContain('id="wizard-date"');
    expect(html).not.toContain('id="wizard-prose"');
  });

  test("something half-written is a choice, not a day to start over", () => {
    const html = render([running()], [
      { trip: "alpen", slug: "2026-01-01-x", date: "2026-01-01", title: "X", photos: 0, written: false },
    ]);
    expect(html).toContain("Nicht fertig geworden");
    expect(html).not.toContain('id="wizard-prose"');
  });

  /** The gates B780 is not allowed to buy a tap with. */
  test("the express screen is not a publish button", () => {
    const html = render([running()]);
    expect(html).not.toContain("Auf die Seite stellen");
    expect(html).not.toContain("Diesen Tag veröffentlichen");
  });
});

describe("what the picker will take", () => {
  test("every extension the inbox can file is one a person can choose", () => {
    for (const ext of INBOX_FILE_EXTENSIONS) {
      expect(PICKER_ACCEPT.split(",")).toContain(ext);
    }
  });

  test("photographs and clips are still first", () => {
    expect(PICKER_ACCEPT.startsWith("image/*,video/*")).toBe(true);
  });

  test("the screen says what may be dropped there", () => {
    expect(render([running()])).toContain("Kontoauszug");
  });
});
