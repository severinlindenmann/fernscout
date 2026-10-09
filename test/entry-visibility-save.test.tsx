// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import TripProvider from "@/components/TripProvider";
import { EntryVisibility } from "@/components/Visibility";
import { dictionaryFor } from "@/lib/locales";
import type { Trip } from "@/lib/types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * B-2937 — the day's visibility sheet wrote to `/day/<slug>/edit`, a route
 * removed with B1595, so every change answered 404 on the live site. It
 * writes through the owner's cookie door `EditDay` uses, and "as the trip
 * says" is a decline, never a `null` that door refuses.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  document.body.innerHTML = "";
  root = undefined;
  container = undefined;
});

async function save(stored: "guest" | undefined, pick: string) {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({ ok: true });
    }),
  );
  vi.stubGlobal("location", { ...window.location, reload: vi.fn() });
  const trip = { id: "japan", username: "alex", visibility: "public", listed: true } as unknown as Trip;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <TripProvider trip={trip} isCurrent reader="person" owner>
          <EntryVisibility entry={{ slug: "start-zueri", visibility: stored }} />
        </TripProvider>
      </LocaleProvider>,
    );
  });
  await act(async () => container!.querySelector<HTMLButtonElement>("button")!.click());
  const radio = document.querySelector<HTMLInputElement>(`input[type=radio][value="${pick}"]`)!;
  await act(async () => radio.click());
  const buttonNamed = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
  // ConfirmPanel: the action first, then its own confirm.
  const first = buttonNamed("Change who may read this");
  if (first) await act(async () => first.click());
  await act(async () => buttonNamed("Yes, change it")!.click());
  return calls;
}

describe("the day's visibility sheet — B-2937", () => {
  test("Private writes visibility through the owner's day door", async () => {
    const calls = await save(undefined, "private");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/web/alex/trips/japan/days/start-zueri");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ visibility: "private" });
  });

  test("back to the trip's own setting is a decline, never null", async () => {
    const calls = await save("guest", "");
    expect(calls[0].url).toBe("/api/web/alex/trips/japan/days/start-zueri");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      declined: { visibility: "shown to everyone the trip lets in" },
    });
  });
});
