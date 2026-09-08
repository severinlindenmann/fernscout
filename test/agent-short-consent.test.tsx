import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentDoor, { type AgentJournal } from "@/components/AgentDoor";
import ConfirmPanel from "@/components/ConfirmPanel";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import { installedLocales } from "@/lib/locales";

/**
 * One line, then "warum?" — B781 — and one email field — B786.
 *
 * Both tickets are about the same failure at two different moments: a screen
 * that hands somebody more than they can act on. A 19-year-old pressed "yes,
 * send my voice" after five of a hundred and sixteen words; a 71-year-old read
 * two identical forms three times and telephoned her son.
 *
 * What is asserted here is the property, not the prose: nothing at a point of
 * decision runs past about twenty-five words, and everything the long version
 * promised — the provider's name above all — is still there behind the
 * expansion. Shortening by deletion would pass a word count and fail the
 * ticket.
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

/** The lines a person meets at the moment they are deciding something. */
const AT_THE_POINT_OF_DECISION = [
  "agent.helperConsentShort",
  "agent.photoConsentShort",
  "agent.speechConsentShort",
  "agent.speechConsentDryRunShort",
  "agent.askConsentShort",
  "agent.statementConsentShort",
  "agent.intro",
  "agent.pickPhotosHint",
] as const;

function words(text: string): number {
  return text.split(/\s+/).filter((w) => /\w/.test(w)).length;
}

describe("one line before the expansion", () => {
  test("nothing at a point of decision runs past 25 words, in any language", () => {
    for (const code of installedLocales()) {
      const dictionary = dictionaryFor(code);
      for (const key of AT_THE_POINT_OF_DECISION) {
        expect(words(dictionary[key]), `${code} ${key}`).toBeLessThanOrEqual(25);
      }
    }
  });

  /** The expansion is where the promises live, and dropping the company's
   *  name would have been the easy way to make a sentence short. */
  test("the long version is still there and still names who receives it", () => {
    const de = dictionaryFor("de");
    expect(de["agent.helperConsent"]).toContain("Anthropic");
    expect(de["agent.photoConsent"]).toContain("Anthropic");
    expect(de["agent.askConsent"]).toContain("Anthropic");
    expect(de["agent.statementConsent"]).toContain("Anthropic");
    // The speech provider is whichever backend is configured, so its name
    // arrives as a parameter rather than in the string — in both halves.
    expect(de["agent.speechConsent"]).toContain("{provider}");
    expect(de["agent.speechConsentShort"]).toContain("{provider}");
    // And the promises the short line has no room for.
    expect(de["agent.speechConsent"]).toContain("Training");
    expect(de["agent.introWhy"]).toContain("Entwurf");
  });

  test("a panel given details draws them behind one expansion", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
        <ConfirmPanel
          label="l"
          question="Die kurze Zeile."
          details="Die ganze lange Erklärung."
          confirmLabel="Ja"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </LocaleProvider>,
    );
    expect(html).toContain("Die kurze Zeile.");
    expect(html).toContain("<details");
    expect(html).toContain("warum?");
    expect(html).toContain("Die ganze lange Erklärung.");
  });

  test("a panel with nothing more to say draws no expansion", () => {
    const html = renderToStaticMarkup(
      <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
        <ConfirmPanel label="l" question="Nur das." confirmLabel="Ja" onConfirm={() => {}} onCancel={() => {}} />
      </LocaleProvider>,
    );
    expect(html).not.toContain("<details");
  });
});

function door(signupEnabled: boolean) {
  return renderToStaticMarkup(
    <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
      <AgentDoor
        siteUrl="https://t.test"
        docUrl="https://t.test/documentation.txt"
        agentUrl="https://t.test/agent.md"
        codeMinutes="20"
        signedIn={false}
        identityEmail={null}
        signupEnabled={signupEnabled}
      />
    </LocaleProvider>,
  );
}

describe("one email field, not two", () => {
  test("a signed-out visitor is asked the question and shown no form yet", () => {
    const html = door(true);
    expect(html).toContain("Hast du schon ein Reisetagebuch?");
    expect(html.split('type="email"').length - 1).toBe(0);
  });

  test("with signup switched off there is only one form, so nothing is asked", () => {
    const html = door(false);
    expect(html).not.toContain("Hast du schon ein Reisetagebuch?");
    expect(html.split('type="email"').length - 1).toBe(1);
  });
});
