import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentDoor from "@/components/AgentDoor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1310 — the WhatsApp door on `/agent`, a stranger's other way in. Gated on
 * nothing but this instance having a number configured at all, the same rule
 * `test/landing.test.tsx` checks for the landing page's own button.
 *
 * B1314 moved it from a loose line above the card into a third action inside
 * the "do you already have a journal?" card, after an "oder"-divider — the
 * owner's chosen design once B1310's plain underlined link shipped without
 * it.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

function renderDoor(whatsappNumber?: string) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <AgentDoor
        docUrl="https://example.test/agent.md"
        agentUrl="https://example.test"
        codeMinutes="30"
        signedIn={false}
        identityEmail={null}
        signupEnabled={true}
        siteName="Fernscout"
        whatsappNumber={whatsappNumber}
      />
    </LocaleProvider>,
  );
}

describe("the /agent door's WhatsApp line", () => {
  test("appears when this instance has a number configured", () => {
    const html = renderDoor("41780000000");
    expect(html).toContain("https://wa.me/41780000000");
    expect(html).toContain("Message us on WhatsApp");
    // B1314 — the divider between the two sign-in buttons and this one.
    expect(html).toContain('role="separator"');
    expect(html).toContain(">or<");
  });

  test("is absent when this instance has no number configured", () => {
    const html = renderDoor();
    expect(html).not.toContain("wa.me");
  });
});

/**
 * B1329 — the chat vignette hero, and the scattered links folding into one
 * quiet line under the card.
 */
describe("the /agent door's chat vignette", () => {
  test("carries the hero title, lede and all four bubbles, in arrival order", () => {
    const html = renderDoor();
    expect(html).toContain("Just tell it what happened.");
    const own1 = html.indexOf("We spent the day in the dunes");
    const agent1 = html.indexOf("Sounds like a lovely day");
    const own2 = html.indexOf("yes, do it");
    const agent2 = html.indexOf("Your draft is waiting");
    expect(own1).toBeGreaterThan(-1);
    expect(agent1).toBeGreaterThan(own1);
    expect(own2).toBeGreaterThan(agent1);
    expect(agent2).toBeGreaterThan(own2);
  });

  test("stages the bubbles and the typing dots with CSS delays, not a timer", () => {
    const html = renderDoor();
    // The own and agent bubbles both use the same once-only arrival class —
    // no JS-scheduled class toggle, no `setTimeout`.
    expect(html).toContain("fs-assemble-in");
    // A typing-dots placeholder element precedes each agent reply, as its
    // own element rather than folded into the bubble's own markup.
    expect(html).toContain("fs-chat-dots");
    // Every stagger is a plain inline `animation-delay`, readable without a
    // browser.
    expect(html).toMatch(/animation-delay:\s*500ms/);
    expect(html).toMatch(/animation-delay:\s*2200ms/);
    expect(html).toMatch(/animation-delay:\s*4900ms/);
  });

  test("thumbnails come from the example journal's own shipped media, not a new binary", () => {
    const html = renderDoor();
    expect(html).toContain("/example/media/usa-2026/oregon-coast/02.jpg");
    expect(html).toContain("/example/media/usa-2026/oregon-coast/03.jpg");
    expect(html).toContain("/example/media/usa-2026/oregon-coast/01.jpg");
  });

  test("prefers-reduced-motion removes the dots outright, in the stylesheet", () => {
    // jsdom does not evaluate `@media (prefers-reduced-motion: reduce)`, so
    // this is checked in the source the browser will actually apply rather
    // than in rendered markup.
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    const reducedMotionBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedMotionBlock).toMatch(/\.fs-chat-dots\s*\{\s*display:\s*none;/);
    expect(reducedMotionBlock).toMatch(/\.fs-assemble-in,?\s*\n?\s*\.fs-waymark-bounce\s*\{\s*\n?\s*animation:\s*none;/);
  });

  test("only the own-agent guide remains under the card; why? and the demo are gone", () => {
    // The owner dropped "why?" and the demo from the door on 2026-09-10 —
    // the vignette does their job. The guide stays, below the card.
    const html = renderDoor();
    const ownAgentIndex = html.indexOf("Already using something like ChatGPT");
    const questionCardIndex = html.indexOf("Do you already have a journal?");
    expect(html.indexOf(">why?<")).toBe(-1);
    expect(html.indexOf("See how it works")).toBe(-1);
    expect(ownAgentIndex).toBeGreaterThan(questionCardIndex);
  });
});
