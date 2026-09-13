// @vitest-environment jsdom
//
// B1674 — the postcard sheet fetched a v1 route the migration deleted, and
// the failure was silent: `recRes.ok` false fell back to `{recipients: []}`
// and rendered "nobody has asked for a card" when the truth was the door had
// moved. This asserts both halves of the fix: the sheet reaches the cookie
// proxy under `/api/web/`, never `/api/v1/`, and a failed request renders the
// honest "could not be prepared" state rather than the false "nobody wants
// one" state.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import PostcardSheet from "@/components/PostcardSheet";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { MediaTile } from "@/lib/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));

const TILE: MediaTile = {
  src: "/alex/media/alps-2024/day-1/01.jpg",
  slug: "2026-08-01-a-day",
  type: "image",
  location: "Zermatt",
  country: "Switzerland",
  date: "2026-08-01",
};

function withLocale(node: React.ReactNode) {
  return <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>{node}</LocaleProvider>;
}

describe("the postcard sheet's fetches", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  function mount() {
    root = createRoot(container!);
    act(() => {
      root!.render(
        withLocale(
          <PostcardSheet username="alex" trip="alps-2024" tile={TILE} from="Alex" onClose={() => {}} />,
        ),
      );
    });
  }

  test("reaches the cookie proxy under /api/web, never the deleted /api/v1 door", async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({ ok: true, json: async () => ({ recipients: [] }) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).not.toContain("/api/v1/");
      expect(url).toMatch(/^\/api\/web\/alex\/postcards\//);
    }
  });

  test("a failed recipients lookup says it could not be prepared, not that nobody wants one", async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        String(url).includes("/recipients")
          ? { ok: false, status: 404, json: async () => ({}) }
          : { ok: true, json: async () => ({ writtenLocale: "en", days: [] }) },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("That could not be prepared");
    expect(container!.textContent).not.toContain("Nobody has asked for a real postcard");
  });

  test("a genuinely empty list says nobody has asked, not that it failed", async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ recipients: [] }) }));
    vi.stubGlobal("fetch", fetchMock);

    mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Nobody has asked for a real postcard");
    expect(container!.textContent).not.toContain("That could not be prepared");
  });
});
