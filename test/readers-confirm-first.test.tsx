// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ReadersAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact } from "@/components/studio/readers/shared";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2133 — Revoke and Approve acted on one tap, next to Edit, with nothing
 * said afterwards. Each now opens a ConfirmPanel naming the person, posts
 * nothing until its confirming button, and leaves a status line. A direct
 * grant reads "You let them in on <long date>", never an ISO date.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/alex/studio/readers",
  useSearchParams: () => new URLSearchParams(),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dict = dictionaryFor("en");

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

const base: Omit<AdminContact, "id" | "name" | "email"> = {
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
};
const ida: AdminContact = { ...base, id: "c-ida", name: "Ida", email: "ida@example.test" };
const otto: AdminContact = {
  ...base,
  id: "c-otto",
  name: "Otto",
  email: "otto@example.test",
  status: "pending",
  createdVia: "asked",
};

function render(contacts: AdminContact[], reply: Record<string, unknown> = { ok: true }) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const posted = init?.method === "POST";
    return {
      ok: true,
      json: async () => (posted ? reply : { contacts, invites: [] }),
    } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dict}>
        <ReadersAdmin
          username="alex"
          locale="en"
          locales={["en"]}
          dictionary={dict}
          contacts={contacts}
          invites={[]}
          hasGuestTrip
        />
      </LocaleProvider>,
    );
  });
  return fetchMock;
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find((one) => (one.textContent ?? "").trim() === text);
  if (!found) throw new Error(`no button "${text}" in: ${container!.textContent}`);
  return found;
}

const posts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("Revoke asks first", () => {
  test("opens a coral ConfirmPanel naming the person and posts nothing", () => {
    const fetchMock = render([ida]);
    act(() => button(dict["contact.adminRevoke"]).click());
    const panel = container!.querySelector('[role="dialog"]');
    expect(panel?.textContent).toContain("Ida");
    const confirm = button(dict["contact.adminRevokeConfirm"].replace("{name}", "Ida"));
    expect(confirm.className).toContain("bg-coral-600");
    expect(posts(fetchMock)).toHaveLength(0);
    act(() => button(dict["me.cancel"]).click());
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test("confirm posts the revoke, then says so in a status line", async () => {
    const fetchMock = render([ida]);
    act(() => button(dict["contact.adminRevoke"]).click());
    await act(async () => button(dict["contact.adminRevokeConfirm"].replace("{name}", "Ida")).click());
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String((sent[0][1] as RequestInit).body))).toEqual({ user: "alex", action: "revoke", id: "c-ida" });
    expect(container!.querySelector('[role="status"]')?.textContent).toBe(
      dict["contact.adminRevoked"].replace("{name}", "Ida"),
    );
  });
});

describe("Approve asks first", () => {
  test("opens a ConfirmPanel naming the person and posts nothing", () => {
    const fetchMock = render([otto]);
    act(() => button(dict["contact.adminApprove"]).click());
    expect(container!.querySelector('[role="dialog"]')?.textContent).toContain("Otto");
    expect(posts(fetchMock)).toHaveLength(0);
  });

  test("confirm posts the approve, then a status line says what it opened", async () => {
    const fetchMock = render([otto], { ok: true, tripsOpened: [] });
    act(() => button(dict["contact.adminApprove"]).click());
    await act(async () => button(dict["contact.adminApproveConfirm"].replace("{name}", "Otto")).click());
    const sent = posts(fetchMock);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String((sent[0][1] as RequestInit).body))).toEqual({ user: "alex", action: "approve", id: "c-otto" });
    expect(container!.querySelector('[role="status"]')?.textContent).toBe(dict["contact.adminApprovedNoTrip"]);
  });
});

describe("a direct grant says who let them in, in words", () => {
  test("You let them in on a long date, never an ISO one", () => {
    render([ida]);
    const text = container!.textContent ?? "";
    expect(text).toContain("You let them in on 24 September 2026.");
    expect(text).not.toContain("2026-09-24");
    expect(text).not.toContain("Confirmed on");
  });
});
