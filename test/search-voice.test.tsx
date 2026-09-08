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
 * B975 — the microphone that turned straight back off and said nothing.
 *
 * Two faults, and the first hid the second: `onerror` took no argument and
 * only set the state back to "off", so a blocked microphone, a browser with
 * no speech service and a bare language code the recogniser refused all
 * looked identical — the panel closed and nothing happened. And the language
 * *was* a bare code: `de`, where the API wants `de-DE`.
 *
 * A real recogniser cannot be driven from a test (and a headless browser has
 * neither a microphone nor a speech service, which is how this went unseen),
 * so the browser's class is stubbed: what is asserted is the contract this
 * component has with it — the tag it sets, and what it says for each failure.
 */
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Handlers = {
  lang: string;
  continuous: boolean;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

const started: Handlers[] = [];

class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: unknown = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  start() {
    started.push(this as unknown as Handlers);
  }
  stop() {}
}

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
  signedIn: false,
  hasIdentity: false,
  canSignIn: true,
  analyticsEnabled: false,
  helperEnabled: false,
  isOwner: false,
};

let host: HTMLDivElement;
let root: Root;

function mount(locale: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
        <SiteProvider value={base}>
          <SearchBox />
        </SiteProvider>
      </LocaleProvider>,
    ),
  );
}

function press(label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent?.includes(label),
  );
  if (!button) throw new Error(`no button for ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

/** Press the microphone and accept the one-time consent panel behind it. */
function startListening() {
  press("Per Sprache suchen");
  press("Mikrofon einschalten");
  return started[started.length - 1];
}

beforeEach(() => {
  started.length = 0;
  window.localStorage.clear();
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRecognition;
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
  vi.unstubAllGlobals();
});

describe("the microphone in the search box", () => {
  test("is started with a full language tag, not the journal's two letters", () => {
    mount("de");
    expect(startListening().lang).toBe("de-DE");
  });

  test("keeps listening through a pause rather than ending at the first silence", () => {
    mount("de");
    expect(startListening().continuous).toBe(true);
  });

  test("says so when the browser blocks the microphone", () => {
    mount("de");
    const r = startListening();
    act(() => r.onerror?.({ error: "not-allowed" }));
    expect(host.textContent).toContain("lässt diese Seite nicht auf das Mikrofon");
  });

  test("says so when the browser has no speech service at all", () => {
    mount("de");
    const r = startListening();
    act(() => r.onerror?.({ error: "network" }));
    expect(host.textContent).toContain("erreicht keinen Spracherkennungsdienst");
  });

  test("names an unexpected code, because a report is the only diagnosis there is", () => {
    mount("de");
    const r = startListening();
    act(() => r.onerror?.({ error: "audio-capture" }));
    expect(host.textContent).toContain("audio-capture");
  });

  test("says nothing when it was this page that stopped it", () => {
    mount("de");
    const r = startListening();
    act(() => r.onerror?.({ error: "aborted" }));
    expect(host.textContent).not.toContain("Mikrofon hat gestoppt");
  });
});
