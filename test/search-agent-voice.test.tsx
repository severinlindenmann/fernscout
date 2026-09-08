// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import SearchBox from "@/components/SearchBox";
import SiteProvider from "@/components/SiteProvider";
import { dictionaryFor } from "@/lib/locales";
import type { SiteSummary } from "@/lib/site";

/**
 * B981 — for the owner, speaking is asking the agent.
 *
 * The browser's own dictation needs a speech service the browser reaches
 * itself, and the owner's did not have one (B975 told them so, correctly and
 * uselessly). This instance has a transcriber of its own, and the owner is
 * the one person whose credits it may spend — so their microphone is
 * `RecordButton`, and what comes back does not sit in the box waiting for a
 * second press: it goes to `/api/helper/<user>/search`.
 *
 * `RecordButton` is stubbed to a plain button that hands over a sentence.
 * Driving a real `MediaRecorder` would test B686's control, which has its own
 * tests; what is asserted here is what this page does with what it returns.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/RecordButton", () => ({
  default: ({ onText }: { onText: (said: string) => void }) => (
    <button type="button" onClick={() => onText("der Tag an dem wir uns verfahren haben")}>
      stub-record
    </button>
  ),
}));

const posted: { url: string; body: string }[] = [];

const base: SiteSummary = {
  username: "alex",
  title: "Alex",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["de"],
  base: "/alex",
  travellerFigures: [],
  signedIn: true,
  hasIdentity: true,
  canSignIn: true,
  analyticsEnabled: false,
  helperEnabled: true,
  isOwner: true,
};

let host: HTMLDivElement;
let root: Root;

function mount(props: React.ComponentProps<typeof SearchBox>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <LocaleProvider locale="de" dictionary={dictionaryFor("de")}>
        <SiteProvider value={base}>
          <SearchBox {...props} />
        </SiteProvider>
      </LocaleProvider>,
    ),
  );
}

beforeEach(() => {
  posted.length = 0;
  (window as unknown as Record<string, unknown>).SpeechRecognition = class {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult = null;
    onend = null;
    onerror = null;
    start() {}
    stop() {}
  };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    posted.push({ url: String(url), body: String(init?.body ?? "") });
    if (String(url).includes("/api/helper/")) {
      return new Response(
        JSON.stringify({
          hits: [
            {
              id: "x/y",
              kind: "day",
              title: "Ein Umweg",
              where: "Domodossola",
              url: "/alex/day/umweg",
              why: "der Tag mit der falschen Abzweigung",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response("{}", { status: 500 });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  vi.unstubAllGlobals();
});

describe("the owner's microphone on the search page", () => {
  test("replaces the browser's own dictation rather than sitting beside it", () => {
    mount({ username: "alex", speech: { consented: true, provider: "Deepgram", balance: 20 } });
    expect(host.textContent).toContain("stub-record");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.getAttribute("aria-label") === "Per Sprache suchen",
      ),
    ).toBe(false);
  });

  test("what was said goes to the agent, with no second press", async () => {
    mount({ username: "alex", speech: { consented: true, provider: "Deepgram", balance: 20 } });
    const record = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("stub-record"),
    )!;
    await act(async () => {
      record.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const ask = posted.find((p) => p.url.includes("/api/helper/alex/search"));
    expect(ask).toBeDefined();
    expect(JSON.parse(ask!.body).said).toBe("der Tag an dem wir uns verfahren haben");
    // And what came back is on the screen, not merely fetched.
    expect(host.textContent).toContain("Ein Umweg");
    // The sentence is in the box too, so it can be corrected and asked again.
    expect(host.querySelector<HTMLInputElement>("#search-input")!.value).toBe(
      "der Tag an dem wir uns verfahren haben",
    );
  });

  test("with no credits left the microphone is disabled and says why", () => {
    mount({ username: "alex", speech: { consented: true, provider: "Deepgram", balance: 0 } });
    expect(host.textContent).toContain("keine mehr");
  });

  test("a reader who is not the owner keeps the browser's microphone", () => {
    mount({ username: "alex" });
    expect(host.textContent).not.toContain("stub-record");
    expect(
      [...host.querySelectorAll("button")].some(
        (b) => b.getAttribute("aria-label") === "Per Sprache suchen",
      ),
    ).toBe(true);
  });
});
