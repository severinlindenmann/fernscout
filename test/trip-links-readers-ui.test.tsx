// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import MePageContent from "@/app/at/[user]/me/MePageContent";
import KeepCard from "@/components/KeepCard";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import ReadersAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact } from "@/components/studio/readers/shared";
import { dictionaryFor } from "@/lib/locales";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import type { HomeLink } from "@/lib/homeProbe";
import type { SiteSummary } from "@/lib/site";
import type { Viewer } from "@/lib/viewer";

/**
 * B-2962/B-2963 — the browser-walk fixes: the trip picker never lands on a
 * disabled trip, a saved trip's Remove asks first, the keep card replaces the
 * generic "not signed in" card, and its day-mail tick is on the first step only.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh }),
  usePathname: () => "/@alex/studio/readers",
  useSearchParams: () => new URLSearchParams(),
}));

const dict = dictionaryFor("en");
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  refresh.mockClear();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

const ida: AdminContact = {
  id: "c-ida",
  name: "Ida Reader",
  email: "ida@example.test",
  locale: "en",
  status: "active",
  wantsEmailDigest: false,
  wantsPostcard: false,
  wantsWhatsapp: false,
  postalAddress: null,
  pushDevices: null,
  createdVia: "owner-grant",
  createdAt: "2026-09-24T06:00:00Z",
  confirmedAt: "2026-09-24T06:00:00Z",
  lastSeenAt: null,
  relationship: { owner: false, buddyOf: [], guest: true },
  savedTrips: [{ keepId: "k-1", trip: "Alps 2026" }],
};

function renderAdmin(trips: { id: string; title: string; visibility?: string }[], contacts: AdminContact[] = []) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ ok: true }) }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  container = container ?? document.body.appendChild(document.createElement("div"));
  root = root ?? createRoot(container);
  const tree = (
    <LocaleProvider locale="en" dictionary={dict}>
      <ReadersAdmin username="alex" locale="en" locales={["en"]} dictionary={dict} contacts={contacts} invites={[]} trips={trips} hasGuestTrip />
    </LocaleProvider>
  );
  act(() => root!.render(tree));
  return { fetchMock, rerender: (next: typeof trips) => act(() => root!.render(
    <LocaleProvider locale="en" dictionary={dict}>
      <ReadersAdmin username="alex" locale="en" locales={["en"]} dictionary={dict} contacts={contacts} invites={[]} trips={next} hasGuestTrip />
    </LocaleProvider>,
  )) };
}

const button = (text: string) => {
  const found = Array.from(container!.querySelectorAll("button")).find((one) => (one.textContent ?? "").trim() === text);
  if (!found) throw new Error(`no button "${text}" in: ${container!.textContent}`);
  return found as HTMLButtonElement;
};

describe("G1 — the read-link trip picker", () => {
  test("lands on the first guest trip, also when the trip list changes after mount", () => {
    const { rerender } = renderAdmin([]);
    act(() => button(dict["readers.link.open"]).click());
    rerender([
      { id: "secret", title: "Secret", visibility: "private" },
      { id: "alps", title: "Alps 2026", visibility: "guest" },
    ]);
    const radio = Array.from(container!.querySelectorAll<HTMLInputElement>('input[name="link-kind"]')).at(-1)!;
    act(() => radio.click());
    const select = Array.from(container!.querySelectorAll("select")).find((s) => s.querySelector('option[value="alps"]'))!;
    expect(select.value).toBe("alps");
    expect(select.selectedOptions[0].disabled).toBe(false);
  });
});

describe("G4 — Remove on a saved trip asks first", () => {
  test("a destructive ConfirmPanel naming the trip; nothing is deleted until its button", async () => {
    const { fetchMock } = renderAdmin([], [ida]);
    const remove = Array.from(container!.querySelectorAll("button")).find((b) => b.getAttribute("aria-label") === `Remove Alps 2026 from Ida Reader`)!;
    act(() => remove.click());
    const dialog = container!.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Alps 2026");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
    const confirm = button("Remove Alps 2026");
    expect(confirm.className).toContain("bg-coral-600");
    await act(async () => confirm.click());
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain("/trip-links/keeps/k-1");
  });
});

const site = { username: "alex", title: "Alex", tagline: "t", url: "https://example.test", startLocation: "X", baseCurrency: "CHF", locales: ["en"], base: "/@alex", hasAccessPanel: true } as unknown as SiteSummary;
const link: HomeLink = { ownerName: "Alex", tripTitle: "Alps", keepPath: "/t/abc", token: "t", signupEnabled: false, kept: false };

function renderMe(viewer: Viewer, keepLink: HomeLink | null) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dict}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <MePageContent viewer={viewer} username="alex" siteUrl="https://example.test" canSignIn codeMinutes={CODE_TTL_MINUTES} ownerName="Alex" contactsEnabled={false} signupEnabled build={{ version: "0" }} keepLink={keepLink} />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("G2 — the keep card and the generic card never stack", () => {
  const nobody: Viewer = { email: null, owner: false, guest: false, trips: [] } as unknown as Viewer;
  test("with a link held, only the keep card; without, the generic one", () => {
    const withLink = renderMe(nobody, link);
    expect(withLink).toContain(dict["tripKeep.title"]);
    expect(withLink).not.toContain(dict["me.strangerTitle"]);
    const without = renderMe(nobody, null);
    expect(without).toContain(dict["me.strangerTitle"]);
    expect(without).not.toContain(dict["tripKeep.title"]);
  });
});

describe("G3 — the day-mail tick is on the first step only", () => {
  test("shown on the form, gone on the code step, and its value is still sent", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (JSON.parse(String(init?.body)).action === "send" ? { ok: true } : { ok: true, kept: true, to: "p***@example.test" }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    act(() => root!.render(<LocaleProvider locale="en" dictionary={dict}><KeepCard link={link} email={null} /></LocaleProvider>));
    const set = (el: HTMLInputElement, value: string) => {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
      proto.set!.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const tick = () => container!.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(tick()).not.toBeNull();
    act(() => set(container!.querySelector<HTMLInputElement>("#keep-name")!, "Pia"));
    act(() => set(container!.querySelector<HTMLInputElement>("#keep-email")!, "pia@example.test"));
    act(() => tick()!.click());
    await act(async () => container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    expect(tick()).toBeNull();
    act(() => set(container!.querySelector<HTMLInputElement>("#keep-code")!, "123456"));
    await act(async () => container!.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const verify = JSON.parse(String(fetchMock.mock.calls[1][1]!.body));
    expect(verify).toMatchObject({ action: "verify", wantsDayMail: true });
  });
});
