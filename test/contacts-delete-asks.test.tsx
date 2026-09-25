// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ContactsAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact } from "@/components/studio/readers/shared";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2053 — Delete on a contact row removed the person, and with them every
 * read grant, on one tap. It now asks first, naming the person, and posts
 * nothing until the owner confirms.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/alex/studio/readers",
  useSearchParams: () => new URLSearchParams(),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dictionary = dictionaryFor("en");

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

const anna: AdminContact = {
  id: "c-anna",
  name: "Anna",
  email: "anna@example.com",
  locale: "en",
  status: "active",
  wantsEmailDigest: true,
  wantsPostcard: false,
  wantsWhatsapp: false,
  postalAddress: null,
  pushDevices: null,
  createdVia: "owner",
  createdAt: "2026-01-01T00:00:00Z",
  confirmedAt: "2026-01-01T00:00:00Z",
  lastSeenAt: null,
  relationship: { owner: false, buddyOf: [], guest: true },
};

function render() {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, contacts: [anna], invites: [] }) }) as Response);
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <ContactsAdmin
          username="alex"
          locale="en"
          locales={["en"]}
          dictionary={dictionary}
          contacts={[anna]}
          invites={[]}
          hasGuestTrip
        />
      </LocaleProvider>,
    );
  });
  return fetchMock;
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container!.querySelectorAll("button")).find(
    (one) => (one.textContent ?? "").trim() === text,
  );
  if (!found) throw new Error(`no button "${text}" in: ${container!.textContent}`);
  return found;
}

function deletes(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([, init]) =>
    String((init as RequestInit | undefined)?.body ?? "").includes('"delete"'),
  );
}

describe("deleting a contact", () => {
  test("asks first, naming the person, and posts nothing yet", () => {
    const fetchMock = render();
    act(() => button(dictionary["contact.adminDelete"]).click());
    const panel = container!.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("Anna");
    expect(deletes(fetchMock)).toHaveLength(0);
    const confirm = button(dictionary["contact.adminDeleteConfirm"].replace("{name}", "Anna"));
    expect(confirm.className).toContain("bg-coral-600");
    expect(confirm.className).not.toContain("bg-yellow-400");
  });

  test("cancel leaves the contact alone", () => {
    const fetchMock = render();
    act(() => button(dictionary["contact.adminDelete"]).click());
    act(() => button(dictionary["me.cancel"]).click());
    expect(container!.querySelector('[role="dialog"]')).toBeNull();
    expect(deletes(fetchMock)).toHaveLength(0);
  });

  test("confirm posts the same delete as before", async () => {
    const fetchMock = render();
    act(() => button(dictionary["contact.adminDelete"]).click());
    await act(async () => {
      button(dictionary["contact.adminDeleteConfirm"].replace("{name}", "Anna")).click();
    });
    const sent = deletes(fetchMock);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String((sent[0][1] as RequestInit).body))).toEqual({
      user: "alex",
      action: "delete",
      id: "c-anna",
    });
  });
});
