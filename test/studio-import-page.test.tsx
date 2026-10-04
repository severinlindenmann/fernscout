import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

/** B-2842 — the Import old trips chooser: A (photos flow) only with extract on, B (helper) always. */

const isEnabled = vi.fn();
vi.mock("@/lib/capabilities", () => ({ isEnabled: (...a: unknown[]) => isEnabled(...a) }));
vi.mock("@/lib/studio/pageGate", () => ({ requireStudioOwner: vi.fn(async () => {}) }));
vi.mock("@/lib/locales", async (orig) => ({ ...(await orig<object>()), requestLocale: async () => "en" }));
vi.mock("@/components/studio/StudioPage", () => ({
  default: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));

import StudioImportPage from "@/app/at/[user]/studio/import/page";

async function html() {
  const el = await StudioImportPage({ params: Promise.resolve({ user: "anna" }) } as never);
  return renderToStaticMarkup(el);
}

describe("studio import page", () => {
  beforeEach(() => isEnabled.mockReset());

  test("extract on: both cards, A opens the photos flow", async () => {
    isEnabled.mockReturnValue(true);
    const out = await html();
    expect(out).toContain("Import old trips");
    expect(out).toContain('data-card="single"');
    expect(out).toContain('href="/@anna/studio/photos"');
    expect(out).toContain('data-card="bulk"');
    expect(out).toContain('href="https://github.com/severinlindenmann/fernscout-helper" target="_blank" rel="noopener"');
    expect(out).toContain("Permissions &amp; keys");
  });

  test("extract off: only the helper card", async () => {
    isEnabled.mockReturnValue(false);
    const out = await html();
    expect(out).not.toContain('data-card="single"');
    expect(out).not.toContain("/studio/photos");
    expect(out).toContain('data-card="bulk"');
  });
});
