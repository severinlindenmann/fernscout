// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import StudioHub from "@/components/studio/StudioHub";
import StudioBarProvider from "@/components/studio/StudioBar";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import {
  ADD_DAY_RESUME_EXPIRY_MS,
  addDayExpiresOn,
  addDayStorageKey,
  readAddDaySnapshot,
} from "@/lib/studio/addDayResume";
import type { StudioHubModel } from "@/lib/studio/hub";

/**
 * B1902 — a half-finished "Add a day" really did persist (`sessionStorage`),
 * but two things did not work: the hub never said so, and the resume screen
 * never stated when the work expires. This covers both halves of the shared
 * read (`lib/studio/addDayResume.ts`) plus the hub actually rendering it.
 */

// The hub renders through StudioPage (B2066), whose PageHeader needs the
// site's provider; its own tests cover it.
vi.mock("@/components/PageHeader", () => ({ default: () => <header /> }));

const USERNAME = "alex";

function writeSnapshot(username: string, overrides: Partial<{ step: string; savedAt: string }> = {}) {
  window.sessionStorage.setItem(
    addDayStorageKey(username),
    JSON.stringify({
      step: "which",
      tripId: "reise",
      date: "2025-11-15",
      title: "",
      content: "",
      location: "",
      country: "",
      savedAt: new Date().toISOString(),
      ...overrides,
    }),
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("readAddDaySnapshot — the one read both the flow and the hub share", () => {
  test("nothing saved: null", () => {
    expect(readAddDaySnapshot(USERNAME)).toBeNull();
  });

  test("a fresh draft comes back whole", () => {
    writeSnapshot(USERNAME);
    const snap = readAddDaySnapshot(USERNAME);
    expect(snap?.step).toBe("which");
    expect(snap?.date).toBe("2025-11-15");
  });

  test("a finished flow (\"done\") is not offered as resumable", () => {
    writeSnapshot(USERNAME, { step: "done" });
    expect(readAddDaySnapshot(USERNAME)).toBeNull();
  });

  test("a draft older than the expiry is forgotten, not resumed", () => {
    const old = new Date(Date.now() - ADD_DAY_RESUME_EXPIRY_MS - 1000).toISOString();
    writeSnapshot(USERNAME, { savedAt: old });
    expect(readAddDaySnapshot(USERNAME)).toBeNull();
    // Forgotten means actually cleared, not just skipped this once.
    expect(window.sessionStorage.getItem(addDayStorageKey(USERNAME))).toBeNull();
  });

  test("addDayExpiresOn is exactly the expiry window after savedAt", () => {
    expect(addDayExpiresOn("2026-01-01T00:00:00.000Z")).toBe("2026-01-08");
  });
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function renderHub(model: StudioHubModel) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <StudioBarProvider username={USERNAME}>
          <StudioHub username={USERNAME} model={model} />
        </StudioBarProvider>
      </LocaleProvider>,
    );
  });
}

const FULL_MODEL: StudioHubModel = {
  kind: "full",
  account: { credits: null, purchasesOpen: 0, storage: null },
  print: { unfinished: [], recentOrders: [] },
  addDayTrip: { id: "reise", title: "Reise", current: true },
  planTrip: null,
  cannotRun: { postcard: false, photobook: false, changeDay: false, reshapeDay: false },
  resumableImports: [],
  analyticsEnabled: false,
  postcardSuggestion: null, routeRecordingTrips: [],
  facts: { drafts: 0, inboxCount: 0, inboxBytes: 0, planStartsInDays: null, readersAsking: 0 },
};

describe("StudioHub — half-done 'Add a day' work reaches the hub (H4)", () => {
  test("no draft: no resume banner, no link to day/new beyond the main card", async () => {
    renderHub(FULL_MODEL);
    // The mount effect runs; flush it.
    await act(async () => {});
    expect(container!.textContent).not.toContain("A day you started, not finished");
  });

  test("a fresh draft shows a resume banner naming when it expires", async () => {
    writeSnapshot(USERNAME);
    renderHub(FULL_MODEL);
    await act(async () => {});
    expect(container!.textContent).toContain("A day you started, not finished");
    expect(container!.textContent).toContain("kept until");
  });

  test("an empty journal's hub surfaces the same draft above its own CTA", async () => {
    writeSnapshot(USERNAME);
    renderHub({ kind: "empty", account: { credits: null, purchasesOpen: 0, storage: null }, print: { unfinished: [], recentOrders: [] }, resumableImports: [], analyticsEnabled: false, postcardSuggestion: null, routeRecordingTrips: [] });
    await act(async () => {});
    expect(container!.textContent).toContain("A day you started, not finished");
  });
});
