// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import NonPhotoImport from "@/components/extract/NonPhotoImport";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1797's three plain uploads — location, contacts, costs — each staging
 * through `POST /api/helper/[user]/inbox` and then (location, costs) calling
 * the importer that already exists. This drives the wiring, not the
 * importers themselves (those have their own tests): does the right second
 * call happen, with the staged file's id, and does the screen show what came
 * back.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function fileInput(): HTMLInputElement {
  return container!.querySelector('input[type="file"]')!;
}

async function chooseAndUpload(file: File) {
  const input = fileInput();
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = Array.from(container!.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Upload"),
  )!;
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mount(kind: "location" | "contacts" | "costs") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <NonPhotoImport username="alex" kind={kind} />
      </LocaleProvider>,
    );
  });
}

describe("location: stages the file, then calls the GPS importer with its inbox id", () => {
  test("shows the numbers the importer read back", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/inbox")) {
          return {
            ok: true,
            json: async () => ({ ok: true, items: [{ id: "abc123-history.json", filename: "history.json" }] }),
          } as Response;
        }
        if (url.includes("/import")) {
          return {
            ok: true,
            json: async () => ({ ok: true, format: "google-timeline", read: 42, from: "2019-01-01", to: "2019-01-10", held: 42 }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await mount("location");
    await chooseAndUpload(new File(["{}"], "history.json", { type: "application/json" }));

    expect(calls.some((u) => u.includes("/api/helper/alex/inbox"))).toBe(true);
    expect(calls.some((u) => u.includes("/api/helper/alex/import"))).toBe(true);
    expect(container!.textContent).toContain("Read 42 points");
  });
});

describe("costs: reads the statement without writing anything", () => {
  test("a recognised bank needs no mapping", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/inbox")) {
          return { ok: true, json: async () => ({ ok: true, items: [{ id: "x.csv", filename: "x.csv" }] }) } as Response;
        }
        if (url.includes("/statement")) {
          return { ok: true, json: async () => ({ ok: true, format: "revolut", label: "Revolut", spent: 0 }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await mount("costs");
    await chooseAndUpload(new File(["a,b"], "statement.csv", { type: "text/csv" }));

    expect(container!.textContent).toContain("Revolut");
    expect(container!.textContent).toContain("Nothing has been written");
  });
});

describe("contacts: stages the file and stops — no read-back door exists yet", () => {
  test("points at the agent room instead of calling an import route", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/inbox")) {
          return { ok: true, json: async () => ({ ok: true, items: [{ id: "a.vcf", filename: "a.vcf" }] }) } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );

    await mount("contacts");
    await chooseAndUpload(new File(["BEGIN:VCARD"], "a.vcf", { type: "text/vcard" }));

    // Only the inbox door is ever called — nothing that parses or files a
    // contact row, because no cookie-gated route for that exists yet (see
    // NonPhotoImport's own doc comment).
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/api/helper/alex/inbox");
    const agentLink = container!.querySelector('a[href="/agent"]');
    expect(agentLink).not.toBeNull();
  });
});
