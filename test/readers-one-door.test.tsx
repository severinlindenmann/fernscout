// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import ReadersAdmin from "@/components/studio/readers/ReadersAdmin";
import type { AdminContact, AdminInvite } from "@/components/studio/readers/shared";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2291 — Studio › Readers is the one place a person is let in: two doors,
 * then the groups by whose turn it is. Every consequential action asks first
 * through a ConfirmPanel naming the person, posts nothing until its
 * confirming button, and leaves a status line (B2133, B2148 for links).
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh }),
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
  refresh.mockClear();
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
const ida: AdminContact = { ...base, id: "c-ida", name: "Ida Reader", email: "ida@example.test" };
const bea: AdminContact = {
  ...base,
  id: "c-bea",
  name: "Bea Buddy",
  email: "bea@example.test",
  relationship: { owner: false, buddyOf: [{ id: "iceland", title: "Iceland 2026" }], guest: true },
};
const otto: AdminContact = { ...base, id: "c-otto", name: "Otto Asks", email: "otto@example.test", status: "pending", createdVia: "asked" };
const nina: AdminContact = {
  ...base,
  id: "c-nina",
  name: "Nina New",
  email: "",
  phone: "+41 79 123 45 12",
  createdVia: "owner",
  invitedVia: "sms",
  invitedAt: "2026-09-25T06:00:00Z",
};
const imp: AdminContact = { ...base, id: "c-imp", name: "Imre Imported", email: "imre@example.test", status: "pending", confirmedAt: null, createdVia: "owner-import" };
const gone: AdminContact = { ...base, id: "c-gone", name: "Gus Gone", email: "gus@example.test", status: "blocked" };
const link: AdminInvite = {
  id: "inv-1",
  kind: "guest",
  tripId: null,
  name: "Family chat",
  locale: null,
  createdAt: "2026-09-20T06:00:00Z",
  expiresAt: "2099-10-25T06:00:00Z",
  revokedAt: null,
  uses: 4,
  url: "http://localhost:3000/alex/invite/guest/fs_inv_x",
  joinUrl: "http://localhost:3000/j/abcdefghjk",
  live: true,
};

function render(contacts: AdminContact[], invites: AdminInvite[] = [], reply: Record<string, unknown> = { ok: true }) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, json: async () => reply }) as Response);
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
          locales={["en", "de"]}
          dictionary={dict}
          contacts={contacts}
          invites={invites}
          trips={[{ id: "iceland", title: "Iceland 2026" }]}
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
const menuFor = (name: string) =>
  Array.from(container!.querySelectorAll("button")).find((one) => one.getAttribute("aria-label") === fill("readers.more", { name }))!;

const sent = (fetchMock: ReturnType<typeof vi.fn>, method: string) =>
  fetchMock.mock.calls.filter(([, init]) => ((init as RequestInit | undefined)?.method ?? "GET") === method);

/** The heading of the section a name sits in. */
function groupOf(name: string): string {
  const li = Array.from(container!.querySelectorAll("li")).find((one) => one.textContent?.includes(name));
  return li?.closest("section")?.querySelector("h2")?.firstChild?.textContent ?? "";
}

describe("the page: two doors, then the groups", () => {
  test("exactly two ways to add someone, and no other form", () => {
    render([]);
    const doors = Array.from(container!.querySelectorAll("section[aria-labelledby^='door-']"));
    expect(doors.map((door) => door.querySelector("h2")?.textContent)).toEqual([
      dict["readers.add.title"],
      dict["readers.link.title"],
    ]);
    expect(container!.querySelectorAll("form")).toHaveLength(0);
  });

  test("everybody sits in the group whose turn it is", () => {
    render([ida, bea, otto, nina, imp, gone], [link]);
    expect(groupOf("Otto Asks")).toBe(dict["contact.adminPending"]);
    expect(groupOf("Nina New")).toBe(dict["readers.group.invited"]);
    expect(groupOf("Imre Imported")).toBe(dict["contact.adminNotInvited"]);
    expect(groupOf("Ida Reader")).toBe(dict["readers.group.reading"]);
    expect(groupOf("Bea Buddy")).toBe(dict["readers.group.reading"]);
    expect(groupOf("Family chat")).toBe(dict["readers.group.links"]);
    // Access taken away is collapsed, behind its own summary.
    const details = container!.querySelector("details:last-of-type");
    expect(details?.querySelector("summary")?.textContent).toBe(fill("readers.group.revoked", { count: "1" }));
    expect(details?.textContent).toContain("Gus Gone");
  });

  test("a request that proved a mobile number is the owner's to answer, not an unopened invite", () => {
    render([{ ...otto, id: "c-moe", name: "Moe Mobile", email: "", phone: "+41 78 123 45 67", confirmedAt: null, phoneProvenAt: "2026-09-25T06:00:00Z", createdVia: "invite:inv-1" }]);
    expect(groupOf("Moe Mobile")).toBe(dict["contact.adminPending"]);
    expect(container!.textContent).toContain(dict["readers.line.mobileConfirmed"]);
  });

  test("role pills: Reader, or Buddy of the trip", () => {
    render([ida, bea]);
    expect(container!.textContent).toContain("Ida Reader" + dict["readers.role.reader"]);
    expect(container!.textContent).toContain("Bea Buddy" + fill("readers.role.buddyOf", { trip: "Iceland 2026" }));
  });

  test("an invited card says how it was sent, and offers the welcome link", () => {
    render([nina]);
    expect(container!.textContent).toContain(fill("readers.line.sentVia", { channel: "SMS", date: "25 September 2026" }));
    button(dict["readers.copyWelcome"]);
    button(dict["readers.sendAgain"]);
  });

  test("the owner's own details are pointed to under Settings, not shown", () => {
    render([]);
    const link = Array.from(container!.querySelectorAll("a")).find((a) => a.textContent === dict["readers.ownDetailsLink"]);
    expect(link?.getAttribute("href")).toBe("/alex/studio/journal#own-details");
  });
});

describe("Let in and Decline ask first", () => {
  test("Let in opens a panel naming the person and posts nothing", () => {
    const fetchMock = render([otto]);
    act(() => button(fill("readers.letIn", { name: "Otto" })).click());
    expect(container!.querySelector('[role="dialog"]')?.textContent).toContain("Otto Asks");
    expect(sent(fetchMock, "POST")).toHaveLength(0);
  });

  test("confirming posts to the letin door, then says what opened and how they were told", async () => {
    const fetchMock = render([otto], [], { ok: true, tripsOpened: [], told: "email" });
    act(() => button(fill("readers.letIn", { name: "Otto" })).click());
    const panel = container!.querySelector('[role="dialog"]')!;
    const confirm = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent === fill("readers.letIn", { name: "Otto" }))!;
    await act(async () => confirm.click());
    const posts = sent(fetchMock, "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0][0]).toBe("/api/web/alex/readers/letin");
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual({ contactId: "c-otto" });
    expect(container!.querySelector('[role="status"]')?.textContent).toBe(
      `${dict["contact.adminApprovedNoTrip"]} ${fill("readers.toldByEmail", { name: "Otto Asks" })}`,
    );
    expect(refresh).toHaveBeenCalled();
  });

  test("Decline is coral, and posts a revoke only once confirmed", async () => {
    const fetchMock = render([otto]);
    act(() => button(dict["readers.decline"]).click());
    const confirm = button(fill("readers.declineConfirm", { name: "Otto" }));
    expect(confirm.className).toContain("bg-coral-600");
    expect(sent(fetchMock, "POST")).toHaveLength(0);
    await act(async () => confirm.click());
    const posts = sent(fetchMock, "POST");
    expect(JSON.parse(String((posts[0][1] as RequestInit).body))).toEqual({ user: "alex", action: "revoke", id: "c-otto" });
  });
});

describe("the ••• menu on a reader", () => {
  test("Take access away is behind a coral ConfirmPanel naming the person", async () => {
    const fetchMock = render([ida]);
    act(() => menuFor("Ida Reader").click());
    act(() => button(dict["readers.menu.takeAway"]).click());
    expect(container!.querySelector('[role="dialog"]')?.textContent).toContain("Ida Reader");
    const confirm = button(fill("readers.takeAwayConfirm", { name: "Ida" }));
    expect(confirm.className).toContain("bg-coral-600");
    expect(sent(fetchMock, "POST")).toHaveLength(0);
    await act(async () => confirm.click());
    expect(JSON.parse(String((sent(fetchMock, "POST")[0][1] as RequestInit).body))).toEqual({
      user: "alex",
      action: "revoke",
      id: "c-ida",
    });
    expect(container!.querySelector('[role="status"]')?.textContent).toBe(fill("contact.adminRevoked", { name: "Ida Reader" }));
  });

  test("Remove asks, and cancel leaves them alone", async () => {
    const fetchMock = render([ida]);
    act(() => menuFor("Ida Reader").click());
    act(() => button(dict["readers.menu.remove"]).click());
    act(() => button(dict["me.cancel"]).click());
    expect(sent(fetchMock, "POST")).toHaveLength(0);
    act(() => menuFor("Ida Reader").click());
    act(() => button(dict["readers.menu.remove"]).click());
    await act(async () => button(fill("contact.adminDeleteConfirm", { name: "Ida Reader" })).click());
    expect(JSON.parse(String((sent(fetchMock, "POST")[0][1] as RequestInit).body))).toEqual({
      user: "alex",
      action: "delete",
      id: "c-ida",
    });
  });

  test("Edit details opens the form in place", () => {
    render([ida]);
    act(() => menuFor("Ida Reader").click());
    act(() => button(dict["readers.menu.edit"]).click());
    expect(container!.querySelector("li form")).not.toBeNull();
  });
});

describe("links you've shared", () => {
  test("shows the short /j/ link, its use count and its end", () => {
    render([], [link]);
    expect(container!.textContent).toContain(fill("readers.link.used", { count: "4" }));
    act(() => button(dict["readers.link.show"]).click());
    expect(container!.textContent).toContain("localhost:3000/j/abcdefghjk");
    expect(container!.textContent).not.toContain("fs_inv_x");
  });

  test("Stop this link asks first, then deletes it (B2148)", async () => {
    const fetchMock = render([], [link]);
    act(() => button(dict["readers.link.stop"]).click());
    expect(container!.querySelector('[role="dialog"]')?.textContent).toContain("Family chat");
    expect(sent(fetchMock, "DELETE")).toHaveLength(0);
    await act(async () => button(dict["readers.link.stopConfirm"]).click());
    const deletes = sent(fetchMock, "DELETE");
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0]).toBe("/api/web/alex/invites/inv-1");
  });

  test("a stopped or expired link is not listed", () => {
    render([], [{ ...link, revokedAt: "2026-09-21T00:00:00Z", live: false }, { ...link, id: "inv-2", expiresAt: "2020-01-01T00:00:00Z", live: false }]);
    expect(container!.textContent).not.toContain("Family chat");
  });
});

describe("Add a person, then step 2", () => {
  function type(label: string, value: string) {
    const input = Array.from(container!.querySelectorAll("label")).find((l) => l.textContent?.startsWith(label))!
      .querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  test("posts step 1 to the readers door, then mounts NotifyStep for that contact", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return { ok: true, json: async () => ({ ok: true, outcome: "created", contact: { id: "c-new", name: "Marco Rossi", status: "active" } }) } as Response;
      }
      // NotifyStep's GET
      return {
        ok: true,
        json: async () => ({
          name: "Marco Rossi",
          url: "http://localhost:3000/w/2345678923",
          to: { email: null, mobile: "+41 ••• 12" },
          channels: [
            { channel: "email", cost: 0, blocked: "no_email", preview: "Hello" },
            { channel: "sms", cost: 1, blocked: null, preview: "Hello" },
            { channel: "self", cost: 0, blocked: null, preview: "http://localhost:3000/w/2345678923" },
          ],
          balance: 5,
          creditPrice: null,
          opened: false,
        }),
      } as Response;
    });
    render([]);
    vi.stubGlobal("fetch", fetchMock);
    act(() => button(dict["readers.add.open"]).click());
    type(dict["readers.add.name"], "Marco Rossi");
    type(dict["readers.add.mobile"], "+41 79 123 45 12");
    await act(async () => button(fill("readers.add.submitNamed", { name: "Marco" })).click());
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/web/alex/readers");
    expect(JSON.parse(String(post[1]!.body))).toEqual({ name: "Marco Rossi", role: "reader", phone: "+41 79 123 45 12", locale: "en" });
    await act(async () => {});
    expect(container!.textContent).toContain(fill("notifyStep.heading", { name: "Marco Rossi" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/web/alex/readers/notify?contactId=c-new")).toBe(true);
  });

  test("an address already refused is its own sentence", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, json: async () => ({ error: "blocked_contact" }) }) as Response);
    render([]);
    vi.stubGlobal("fetch", fetchMock);
    act(() => button(dict["readers.add.open"]).click());
    type(dict["readers.add.name"], "Gus");
    type(dict["readers.add.email"], "gus@example.test");
    await act(async () => button(fill("readers.add.submitNamed", { name: "Gus" })).click());
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(dict["readers.add.error.blocked"]);
  });

  test("neither email nor mobile is refused before anything is posted", async () => {
    const fetchMock = render([]);
    act(() => button(dict["readers.add.open"]).click());
    type(dict["readers.add.name"], "Nobody");
    await act(async () => button(fill("readers.add.submitNamed", { name: "Nobody" })).click());
    expect(sent(fetchMock, "POST")).toHaveLength(0);
    expect(container!.querySelector('[role="alert"]')?.textContent).toBe(dict["readers.add.error.noChannel"]);
  });
});
