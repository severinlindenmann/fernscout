// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { resetNavigation } from "./fixtures/fakeNavigation";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pushed: string[] = [];
vi.mock("next/navigation", async () => {
  const base = (await import("./fixtures/fakeNavigation")).navigationMock("/@alex/studio/day/new");
  return {
    ...base,
    useRouter: () => ({ ...base.useRouter(), push: (href: string) => pushed.push(href) }),
  };
});

vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

/**
 * Add a day, start to finish — TIX-2: the assistant choice and its consent,
 * a long day offered in parts, each part saved as its own draft (a later part
 * as a second entry at its own time), then "Check your day", where the
 * assistant's suggestions are shown and only "Looks good" writes them, and
 * the hand-off to the publish step with every part.
 */

const { default: DayFlow } = await import("@/components/studio/day/DayFlow");
const { default: StudioBarProvider } = await import("@/components/studio/StudioBar");
const { default: StudioPage } = await import("@/components/studio/StudioPage");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

const dict = dictionaryFor("en");
const TRIPS = [{ id: "utah", title: "Utah", start: "2025-09-01", end: "2025-09-30" }];
const photo = (id: string, time: string, lat: number, lon: number) => ({
  id,
  filename: `${id}.jpg`,
  bytes: 10,
  uploadedAt: "2025-09-08T00:00:00Z",
  takenAt: `2025-09-07T${time}:00`,
  lat,
  lon,
});
// One long day: Bryce at dawn, the byway around noon, Capitol Reef at dusk.
const INBOX = [
  photo("b1", "06:02", 37.62, -112.16),
  photo("b2", "06:40", 37.62, -112.16),
  photo("b3", "07:40", 37.63, -112.17),
  photo("e1", "11:20", 37.77, -111.6),
  photo("e2", "12:05", 37.78, -111.6),
  photo("c1", "16:15", 38.28, -111.25),
  photo("c2", "17:00", 38.28, -111.25),
  photo("c3", "18:30", 38.29, -111.25),
];

let root: Root | undefined;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: Record<string, unknown> | null }[];
let props: Record<string, unknown>;
let created = 0;

beforeEach(() => {
  calls = [];
  pushed.length = 0;
  created = 0;
  props = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      if (url.endsWith("/inbox")) return Response.json({ media: [...INBOX].reverse() });
      if (url.includes("/day/new")) {
        created += 1;
        return Response.json({ ok: true, slug: `2025-09-07-part-${created}` }, { status: 201 });
      }
      if (url.includes("/day?") && method === "GET") {
        const slug = new URL(url, "https://x.test").searchParams.get("slug");
        return Response.json({
          ok: true,
          preview: {
            day: {
              entries: [
                {
                  slug,
                  date: "2025-09-07",
                  time: "06:02",
                  title: "",
                  content: "set an alarm for half past five the hoodoos go orange",
                  location: "Bryce Canyon",
                  gallery: [{ src: `/@alex/media/utah/${slug}/01.jpg`, type: "image" }],
                },
              ],
            },
          },
        });
      }
      if (url.includes("/day/write-day")) {
        return body?.mode === "titles"
          ? Response.json({ ok: true, titles: ["Hoodoos at half past five"] })
          : Response.json({ ok: true, draft: { title: "", prose: "Set an alarm for half past five. The hoodoos go orange." } });
      }
      if (url.includes("/day/describe-photos")) {
        return Response.json({ ok: true, captions: [{ src: "/media/utah/x/01.jpg", caption: "Orange rock towers" }] });
      }
      if (url.includes("/api/helper/alex/day") && method === "PATCH") {
        return Response.json({ ok: true, draft: { slug: body?.slug } });
      }
      return Response.json({ ok: true });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  resetNavigation();
});

async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <LocaleProvider dictionary={dict} locale="en">
        <StudioBarProvider username="alex">
          <StudioPage username="alex" group="write" title="A day">
          <DayFlow
            username="alex"
            trips={TRIPS}
            writtenDatesByTrip={{ utah: ["2025-09-06"] }}
            proposal={null}
            initialPhotos="2025-09-07"
            assistantChoice={null}
            assistantPossible
            helperOn
            consents={{ words: false, photos: false, speech: false }}
            providers={{ words: "Anthropic", speech: "Deepgram" }}
            {...props}
          />
          </StudioPage>
        </StudioBarProvider>
      </LocaleProvider>,
    ),
  );
  await flush();
}
async function flush() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function button(label: string): HTMLButtonElement {
  const b = Array.from(document.querySelectorAll("button")).find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no button ${JSON.stringify(label)} in: ${document.body.textContent}`);
  return b;
}
async function click(label: string) {
  await act(async () => button(label).click());
  await flush();
}
const text = () => document.body.textContent ?? "";
const sent = (part: string, method = "POST") => calls.filter((c) => c.url.includes(part) && c.method === method);

describe("the assistant is asked once, with its consent", () => {
  test("its buttons are on the desktop bar too, not only the phone's", async () => {
    await mount();
    expect(button(dict["studio.flow.without"]).closest(".md\\:hidden")).toBeNull();
  });

  test("Without remembers off and goes straight on", async () => {
    await mount();
    expect(text()).toContain(dict["studio.flow.hintTitle"]);
    await click(dict["studio.flow.without"]);
    expect(sent("/studio/assistant", "PATCH")[0].body).toEqual({ assistant: "off" });
    expect(text()).toContain(dict["studio.flow.splitTitle"].replace("{count}", "3"));
  });

  test("With asks for consent first, naming both providers, then records it", async () => {
    await mount();
    await click(dict["studio.flow.with"]);
    expect(text()).toContain("Anthropic");
    expect(text()).toContain("Deepgram");
    expect(sent("/consent")).toHaveLength(0);
    await click(dict["studio.flow.consentAgree"]);
    expect(sent("/consent").map((c) => c.body?.scope)).toEqual(["words", "photos", "speech"]);
    expect(sent("/studio/assistant", "PATCH")[0].body).toEqual({ assistant: "on" });
  });
});

describe("B2649 — the assistant switch", () => {
  test("a switch, On with a green dot; Off saves and shows Off", async () => {
    props = { assistantChoice: "on", consents: { words: true, photos: true, speech: true } };
    await mount();
    await click(dict["studio.flow.splitNo"]);
    const sw = document.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    expect(sw.textContent).toContain(dict["studio.flow.switchOn"]);
    await act(async () => sw.click());
    await flush();
    expect(sent("/studio/assistant", "PATCH").at(-1)!.body).toEqual({ assistant: "off" });
    expect(document.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("false");
  });

  test("a choice that did not save stays as it was and says so", async () => {
    props = { assistantChoice: "on", consents: { words: true, photos: true, speech: true } };
    await mount();
    await click(dict["studio.flow.splitNo"]);
    const base = globalThis.fetch as unknown as (url: string, init?: RequestInit) => Promise<Response>;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (url.includes("/studio/assistant") ? new Response("{}", { status: 500 }) : base(url, init))));
    await act(async () => (document.querySelector('[role="switch"]') as HTMLButtonElement).click());
    await flush();
    expect(document.querySelector('[role="switch"]')!.getAttribute("aria-checked")).toBe("true");
    expect(text()).toContain(dict["studio.flow.choiceFailed"]);
  });
});

describe("a long day in parts, then Check your day, then publish", () => {
  test("three parts: each saved as its own draft, later ones as second entries at their own time", async () => {
    props = { assistantChoice: "on", consents: { words: true, photos: true, speech: true } };
    await mount();
    expect(text()).toContain("Part 1: 06:02–07:40");
    await click(dict["studio.flow.splitYes"].replace("{count}", "3"));

    await click(dict["studio.flow.next"]);
    await click(dict["studio.flow.next"]);
    await click(dict["studio.flow.check"]);
    const saves = sent("/day/new");
    expect(saves).toHaveLength(3);
    expect(saves.map((s) => s.body?.mediaInboxIds)).toEqual([["b1", "b2", "b3"], ["e1", "e2"], ["c1", "c2", "c3"]]);
    expect(saves.map((s) => s.body?.time)).toEqual(["06:02", "11:20", "16:15"]);
    expect(saves.map((s) => s.body?.confirmSecondEntry)).toEqual([false, true, true]);

    // Check your day: the tidied words, a title from them, captions — shown, not yet written.
    await flush();
    expect(text()).toContain(dict["studio.check.title"]);
    expect(text()).toContain("Set an alarm for half past five. The hoodoos go orange.");
    expect(text()).toContain("Hoodoos at half past five");
    expect(sent("/api/helper/alex/day", "PATCH")).toHaveLength(0);
    // The polish counts its AI day against the part's own date.
    expect(sent("/day/write-day")[0].body?.date).toBe("2025-09-07");

    // Keep mine on the first part, pick the suggested title on the second.
    await act(async () => Array.from(document.querySelectorAll("button")).filter((b) => b.textContent === dict["studio.check.keepMine"])[0].click());
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="title-part-2"]'));
    await act(async () => radios[0].click());
    await click(dict["studio.check.looksGood"]);

    const patches = sent("/api/helper/alex/day", "PATCH");
    expect(patches).toHaveLength(3);
    expect(patches[0].body?.content).toBeUndefined();
    expect(patches[1].body?.content).toBe("Set an alarm for half past five. The hoodoos go orange.");
    expect(patches[1].body?.title).toBe("Hoodoos at half past five");
    expect(patches[1].body?.captions).toEqual({ "/media/utah/x/01.jpg": "Orange rock towers" });
    expect(pushed.at(-1)).toBe("/@alex/studio/day/publish?day=part-1&trip=utah&also=part-2,part-3");
  });

  test("without the assistant, nothing is sent to a model and Check just shows the day", async () => {
    props = { assistantChoice: "off" };
    await mount();
    await click(dict["studio.flow.splitNo"]);
    await click(dict["studio.flow.check"]);
    await flush();
    expect(text()).toContain(dict["studio.check.ledePlain"]);
    expect(sent("/day/write-day")).toHaveLength(0);
    expect(sent("/day/describe-photos")).toHaveLength(0);
    await click(dict["studio.check.looksGood"]);
    expect(sent("/api/helper/alex/day", "PATCH")).toHaveLength(0);
    expect(pushed.at(-1)).toBe("/@alex/studio/day/publish?day=part-1&trip=utah");
  });
});
