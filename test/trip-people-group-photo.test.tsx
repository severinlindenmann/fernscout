// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cropBox } from "@/lib/figures/groupPhoto";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B-2847 phase 2 - figures from a group photo. The assistant is mocked: the
 * fetch stub answers the describe route. Only crops are posted, one per
 * marked person; the original photo never is.
 */
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/@alex/studio/trip",
  useSearchParams: () => new URLSearchParams(),
}));
const crop = vi.fn(async () => new Blob(["crop-bytes"], { type: "image/jpeg" }));
vi.mock("@/lib/figures/groupPhoto", async (orig) => ({
  ...(await orig<typeof import("@/lib/figures/groupPhoto")>()),
  openPhoto: async () => ({ url: "blob:x", width: 3000, height: 2000, crop, close: () => {} }),
}));

const { TripPeopleRow } = await import("@/components/studio/trip/TripPeopleSheet");
const { default: LocaleProvider } = await import("@/components/LocaleProvider");
const { dictionaryFor } = await import("@/lib/locales");

let root: Root;
let container: HTMLDivElement;
let calls: { url: string; method: string; body: unknown }[];

function mount(photoConsent: boolean) {
  act(() =>
    root.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <ul>
          <TripPeopleRow
            defaultOpen
            username="alex"
            tripId="t1"
            owner={{ name: "Alex", email: "alex@example.test" }}
            initialPeople={[]}
            contacts={[{ name: "Robin Fox", email: "robin@example.test" }]}
            initialFigures={[]}
            figureSet={[]}
            photoConsent={photoConsent}
          />
        </ul>
      </LocaleProvider>,
    ),
  );
}

beforeEach(() => {
  calls = [];
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  crop.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body;
      calls.push({ url, method: init?.method ?? "GET", body: typeof body === "string" ? JSON.parse(body) : body });
      if (url.endsWith("/figures/from-photo")) {
        return Response.json({ ok: true, figures: [{ position: 0, figure: { hair: "black", shirt: "coral" }, unanswerable: [] }] });
      }
      if (url.includes("/figures/") && init?.method === "PUT") return Response.json(JSON.parse(String(body)));
      return new Response("{}", { status: 200 });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const click = (el: Element) => act(async () => (el as HTMLElement).click());
const byText = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text))!;
function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function openAndMark(taps: number) {
  if (!container.querySelector('input[type="file"]')) await click(byText("Make figures from a photo"));
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["full-photo"], "group.jpg", { type: "image/jpeg" })] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  const area = container.querySelector('[data-testid="group-photo"]')!;
  for (let i = 0; i < taps; i++) {
    await act(async () => area.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10 + i * 5, clientY: 10 })));
  }
}

describe("figures from a group photo", () => {
  test("the crop box is generous, square and stays inside the photo", () => {
    expect(cropBox({ x: 0.5, y: 0.5 }, 3000, 2000)).toEqual({ sx: 990, sy: 490, size: 1020 });
    const corner = cropBox({ x: 0, y: 1 }, 3000, 2000);
    expect(corner.sx).toBe(0);
    expect(corner.sy + corner.size).toBe(2000);
  });

  test("consent line first; only marked crops are sent, never the photo", async () => {
    mount(true);
    await click(byText("Make figures from a photo"));
    expect(container.textContent).toContain("only to describe how people look, and is not kept");
    await openAndMark(2);
    expect(calls.filter((c) => c.url.endsWith("/from-photo"))).toHaveLength(0);
    await click(byText("Describe 2 marked"));
    const posts = calls.filter((c) => c.url.endsWith("/figures/from-photo"));
    expect(posts).toHaveLength(2);
    expect(crop).toHaveBeenCalledTimes(2);
    for (const p of posts) {
      const file = (p.body as FormData).get("photo") as File;
      expect(file.name).toMatch(/^person-\d\.jpg$/);
      expect(await file.text()).toBe("crop-bytes");
    }
  });

  test("keep stays disabled until every card is named or discarded; nothing is matched", async () => {
    mount(true);
    await openAndMark(2);
    await click(byText("Describe 2 marked"));
    const keep = () => byText("Keep figures") as HTMLButtonElement;
    expect(keep().disabled).toBe(true);
    const names = container.querySelectorAll<HTMLInputElement>('input[aria-label^="Name for person"]');
    expect(names).toHaveLength(2);
    // The contact exists but typing its exact name does not link it.
    act(() => type(names[0], "Robin Fox"));
    expect(keep().disabled).toBe(true);
    await click([...container.querySelectorAll("button")].filter((b) => b.textContent === "Discard")[1]);
    expect(keep().disabled).toBe(false);
    await click(keep());
    const put = calls.find((c) => c.method === "PUT")!;
    expect(put.url).toBe("/api/web/alex/figures/robin-fox");
    expect(put.body).toMatchObject({ name: "Robin Fox", hair: "black" });
    expect(put.body).not.toHaveProperty("person");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    // Joins the trip's figure set and the byline, name-only.
    expect(calls.find((c) => c.url.endsWith("/trips/t1/figures"))!.body).toEqual({ figures: { mode: "custom", figures: ["robin-fox"] } });
    expect(calls.find((c) => c.url === "/api/web/alex/trips/t1")!.body).toEqual({
      people: [{ name: "Alex", email: "alex@example.test" }, { name: "Robin Fox" }],
    });
  });

  test("a picked contact carries its address; that's me adds no one", async () => {
    mount(true);
    await openAndMark(2);
    await click(byText("Describe 2 marked"));
    const picks = container.querySelectorAll<HTMLSelectElement>('select[aria-label^="Pick for person"]');
    await act(async () => {
      picks[0].value = "robin@example.test";
      picks[0].dispatchEvent(new Event("change", { bubbles: true }));
      picks[1].value = "@me";
      picks[1].dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(byText("Keep figures"));
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.map((p) => (p.body as { person?: string }).person)).toEqual(["robin@example.test", "alex@example.test"]);
    expect(calls.find((c) => c.url === "/api/web/alex/trips/t1")!.body).toEqual({
      people: [{ name: "Alex", email: "alex@example.test" }, { name: "Robin Fox", email: "robin@example.test" }],
    });
  });

  test("a failed crop shows its own retry while the others stay", async () => {
    let n = 0;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) =>
      url.endsWith("/figures/from-photo") && n++ === 0
        ? new Response("{}", { status: 502 })
        : Response.json({ ok: true, figures: [{ position: 0, figure: { hair: "black" }, unanswerable: [] }] }),
    );
    mount(true);
    await openAndMark(2);
    await click(byText("Describe 2 marked"));
    expect(container.textContent).toContain("That did not go through.");
    expect(container.querySelectorAll('input[aria-label^="Name for person"]')).toHaveLength(1);
    await click(byText("Retry"));
    expect(container.querySelectorAll('input[aria-label^="Name for person"]')).toHaveLength(2);
  });

  test("with the assistant off the option says so and names still save", async () => {
    mount(false);
    expect(byText("Make figures from a photo")).toBeUndefined();
    expect(container.textContent).toContain("needs the assistant");
    const input = container.querySelector<HTMLInputElement>("#trip-people-add")!;
    act(() => type(input, "Maya"));
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({
      people: [{ name: "Alex", email: "alex@example.test" }, { name: "Maya" }],
    });
  });
});

describe("the describe route", () => {
  test("refuses a bearer token", async () => {
    const { POST } = await import("@/app/api/web/[user]/figures/from-photo/route");
    const res = await POST(
      new Request("http://x.test/api/web/alex/figures/from-photo", { method: "POST", headers: { authorization: "Bearer t" } }),
      { params: Promise.resolve({ user: "alex" }) } as never,
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("not_for_agents");
  });
});
