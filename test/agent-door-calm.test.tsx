import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentDoor, { type AgentJournal } from "@/components/AgentDoor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The helper's first screen, in German — B767.
 *
 * The owner looked at the live one and said it felt overwhelming: six
 * controls, four of them competing for the same tap, and the thing the person
 * came to do not among them as something to press. The properties asserted
 * here are the ones a person cannot check by reading the diff — how many
 * bright things there are, and whether a price or a balance is on the screen
 * before anybody has decided to spend anything.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

function journal(over: Partial<AgentJournal> = {}): AgentJournal {
  return {
    username: "alex",
    title: "Alex' Reisetagebuch",
    drafts: [],
    helper: true,
    consented: true,
    speech: true,
    consentedSpeech: true,
    speechProvider: "dry-run",
    credits: 40,
    ...over,
  };
}

function render(one: AgentJournal) {
  return renderToStaticMarkup(
    <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
      <AgentDoor
        siteUrl="https://t.test"
        docUrl="https://t.test/documentation.txt"
        agentUrl="https://t.test/agent.md"
        codeMinutes="20"
        signedIn
        identityEmail="alex@example.test"
        signupEnabled
        journals={[one]}
      />
    </LocaleProvider>,
  );
}

/**
 * Yellow is the primary colour, counted in the journal's own card.
 *
 * The handover panel below the rule is `AgentHandover`, shared with
 * `/<user>/me` and `/<user>/trips` and deliberately untouched here — it is a
 * different section behind a border, for a different reader.
 */
function brightThings(html: string): number {
  const card = html.split("border-t border-navy-200 pt-6")[0];
  return card.split("bg-yellow-400").length - 1;
}

describe("one obvious thing to press", () => {
  test("exactly one bright control in the card, and it says what the person came to do", () => {
    const html = render(journal());
    expect(brightThings(html)).toBe(1);
    expect(html).toContain("Einen Tag schreiben");
  });

  test("an unfinished day takes the button over, and the button names it", () => {
    const html = render(
      journal({
        drafts: [
          { trip: "t", slug: "2026-05-04-a", date: "2026-05-04", title: "a", photos: 3, written: false },
        ],
      }),
    );
    expect(brightThings(html)).toBe(1);
    expect(html).toContain("fertig schreiben");
    expect(html).toContain("4. Mai");
  });
});

describe("nothing on this screen carries a price", () => {
  test("no credit count on any label", () => {
    const html = render(journal());
    expect(html).not.toContain("Guthaben");
  });

  test("the balance is absent while there is plenty of it", () => {
    expect(render(journal({ credits: 40 }))).not.toContain("Nur noch");
  });

  test("and earns one line when it is nearly gone", () => {
    expect(render(journal({ credits: 3 }))).toContain("Nur noch 3 Guthaben");
  });

  test("an instance with credits switched off says nothing either way", () => {
    expect(render(journal({ credits: null }))).not.toContain("Nur noch");
  });
});

describe("the ask box is quiet and second", () => {
  test("one sentence-case line, no box and no microphone until it is tapped", () => {
    const html = render(journal());
    expect(html).toContain("Oder frag mich etwas");
    expect(html).not.toContain("<input");
    // The spoken-language select is a question about ASR codes; it belongs in
    // the recording panel, once speaking has been chosen.
    expect(html).not.toContain("Die Sprache, die du sprichst");
  });

  test("no mono uppercase heading over it", () => {
    expect(render(journal())).not.toContain("Was möchtest du tun?");
  });
});
