import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import AgentDoor from "@/components/AgentDoor";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1310 — the short WhatsApp line on the `/agent` door, a stranger's other
 * way in. Gated on nothing but this instance having a number configured at
 * all, the same rule `test/landing.test.tsx` checks for the landing page's
 * own link.
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
    expect(html).toContain("Or message us on WhatsApp");
  });

  test("is absent when this instance has no number configured", () => {
    const html = renderDoor();
    expect(html).not.toContain("wa.me");
  });
});
