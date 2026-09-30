// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ReadersAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact, AdminGroup, AdminInvite } from "@/components/studio/readers/shared";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * Reader groups on Studio › Readers — TIX-6, what the owner sees and presses.
 * The routes behind the buttons are `test/reader-groups.test.ts`; this is the
 * page: a pill per person, chips that narrow every list, the Keep-or-Move
 * question, and a first-time strip that suggests groups rather than showing
 * empty chips.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  usePathname: () => "/alex/studio/readers",
  useSearchParams: () => new URLSearchParams(),
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const dict = dictionaryFor("en");
const fill = (key: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((text, [k, v]) => text.replaceAll(`{${k}}`, v), dict[key]);

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
});

const family: AdminGroup = { id: "g-fam", name: "Family", color: 0 };
const work: AdminGroup = { id: "g-work", name: "Work", color: 2 };
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
  lastSeenAt: "2026-09-29T06:00:00Z",
  relationship: { owner: false, buddyOf: [], guest: true },
};
const anna: AdminContact = { ...base, id: "c-anna", name: "Anna Keller", email: "anna@example.test", groupId: family.id };
const chris: AdminContact = {
  ...base,
  id: "c-chris",
  name: "Chris Meier",
  email: "chris@example.test",
  groupId: work.id,
  askedGroupId: family.id,
};
const sara: AdminContact = { ...base, id: "c-sara", name: "Sara Frei", email: "sara@example.test", groupId: null };
const link: AdminInvite = {
  id: "inv-1",
  kind: "guest",
  tripId: null,
  name: "Family chat",
  locale: null,
  createdAt: "2026-09-20T06:00:00Z",
  expiresAt: "2099-10-25T06:00:00Z",
  revokedAt: null,
  uses: 2,
  url: null,
  joinUrl: "http://localhost:3000/j/abcdefghjk",
  live: true,
  groupId: family.id,
};

function render(contacts: AdminContact[], groups: AdminGroup[], invites: AdminInvite[] = []) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => ({ ok: true }) }) as Response);
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
          groups={groups}
          invites={invites}
          hasGuestTrip
        />
      </LocaleProvider>,
    );
  });
  return fetchMock;
}

const buttons = () => Array.from(container!.querySelectorAll("button"));
const text = () => container!.textContent ?? "";
const pillOf = (name: string, group: string) =>
  buttons().find((b) => b.getAttribute("aria-label") === fill("readers.groups.pillLabel", { name, group }));

describe("groups on the Readers page", () => {
  test("with no groups yet: suggestions, no pills, no pickers", () => {
    render([sara], []);
    expect(text()).toContain(dict["readers.groups.intro"]);
    expect(buttons().some((b) => b.textContent === `+ ${dict["readers.groups.suggest.family"]}`)).toBe(true);
    expect(pillOf("Sara Frei", dict["readers.groups.none"])).toBeUndefined();
  });

  test("each card shows its group, and the pill opens the choice in place", async () => {
    const fetchMock = render([anna, sara], [family, work]);
    const pill = pillOf("Anna Keller", "Family")!;
    expect(pill).toBeDefined();
    expect(pillOf("Sara Frei", dict["readers.groups.none"])).toBeDefined();
    act(() => pill.click());
    const workChoice = Array.from(container!.querySelectorAll<HTMLInputElement>("input[type=radio][name='group-c-anna']"));
    expect(workChoice.length).toBe(3); // Family, Work, No group
    await act(async () => {
      workChoice[1].click();
    });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/readers/group"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ contactId: "c-anna", group: "g-work" });
  });

  test("a group chip narrows the lists to that group", () => {
    render([anna, sara], [family, work]);
    const chip = buttons().find((b) => b.getAttribute("role") === "radio" && b.textContent?.startsWith("Family"))!;
    act(() => chip.click());
    expect(text()).toContain("Anna Keller");
    expect(text()).not.toContain("Sara Frei");
  });

  test("somebody asked again through another group's link: Keep or Move, nothing moved yet", async () => {
    const fetchMock = render([chris], [family, work]);
    expect(text()).toContain(fill("readers.groups.asked", { name: "Chris", offered: "Family", current: "Work" }));
    const move = buttons().find((b) => b.textContent === fill("readers.groups.move", { group: "Family" }))!;
    await act(async () => {
      move.click();
    });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/readers/group"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ contactId: "c-chris", asked: "move" });
  });

  test("a link says where its joins go", () => {
    render([], [family], [link]);
    expect(text()).toContain(fill("readers.groups.linkGoes", { group: "Family" }));
  });
});
