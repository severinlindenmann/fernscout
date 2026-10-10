// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import Toasts from "@/components/Toasts";
import { apiWrite, dismissToast, getToasts } from "@/lib/toast";
import { dictionaryFor } from "@/lib/locales";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  getToasts().forEach((t) => dismissToast(t.id));
  document.body.innerHTML = "";
});

async function failWith(response: Response | null) {
  vi.stubGlobal("fetch", vi.fn(async () => { if (!response) throw new Error("net"); return response; }));
  const el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(<LocaleProvider locale="en" dictionary={dictionaryFor("en")}><Toasts /></LocaleProvider>);
  });
  await act(async () => { await apiWrite("Saving the day", "/api/x", { method: "PATCH" }); });
  return el;
}

test("a 4xx names the action, the API's reason and its code", async () => {
  const el = await failWith(
    Response.json(
      { error: "invalid_request", message: "Bad body.", details: [{ field: "days.3", problem: "reason needs at least 10 characters" }] },
      { status: 400 },
    ),
  );
  const alert = el.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Saving the day did not work");
  expect(alert.textContent).toContain("days.3: reason needs at least 10 characters");
  expect(alert.textContent).toContain("invalid_request");
});

test("a 500 shows status and request id, never the server's message", async () => {
  const el = await failWith(
    new Response(JSON.stringify({ error: "x", message: "stack: secret" }), { status: 500, headers: { "x-request-id": "ab12cd34" } }),
  );
  const text = el.querySelector('[role="alert"]')!.textContent!;
  expect(text).toContain("Reference: 500 ab12cd34");
  expect(text).not.toContain("secret");
});

test("a network error says nothing more is known, and dismisses", async () => {
  const el = await failWith(null);
  expect(el.textContent).toContain("No reason came back");
  await act(async () => { el.querySelector("button")!.click(); });
  expect(el.querySelector('[role="alert"]')).toBeNull();
});
