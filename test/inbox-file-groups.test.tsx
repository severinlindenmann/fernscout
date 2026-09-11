// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test } from "vitest";
import { InboxFileGroups, type InboxFile } from "@/components/InboxFileGroups";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * The grouped, newest-first view over the inbox — B1123.
 *
 * `HelperRoom.tsx` is not wired to this yet (see the ticket's report); this
 * proves the component's own three claims in isolation: photographs and
 * documents land in different groups, each group is newest first, and a
 * document row carries its size and date rather than nothing at all.
 */

const dictionary = dictionaryFor("en");
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function render(files: InboxFile[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionary}>
        <InboxFileGroups files={files} selected={[]} onToggle={() => {}} onRemove={() => {}} />
      </LocaleProvider>,
    );
  });
  return container;
}

const OLD = "2026-01-01T00:00:00.000Z";
const NEW = "2026-06-01T00:00:00.000Z";

describe("grouped by kind", () => {
  test("a photograph and a document land in different, correctly labelled groups", () => {
    const el = render([
      { id: "inbox:a", name: "beach.jpg", kind: "photo", src: "/x/thumb.webp", at: NEW },
      { id: "inbox:b", name: "statement.csv", kind: "document", bytes: 2048, at: OLD },
    ]);
    expect(el.textContent).toContain("Photographs");
    expect(el.textContent).toContain("Documents");
    expect(el.textContent).toContain("beach.jpg");
    expect(el.textContent).toContain("statement.csv");
    // Each name renders once, inside its own group only.
    expect(el.querySelectorAll("img").length).toBe(1);
  });

  test("a group with nothing in it draws no heading at all", () => {
    const el = render([{ id: "inbox:a", name: "beach.jpg", kind: "photo", at: NEW }]);
    expect(el.textContent).not.toContain("Documents");
  });
});

describe("a video tile", () => {
  // B1380: a video's `src` points at the thumbnail route, which 404s for a
  // video (sharp cannot resize one) — pointing an `<img>` at it drew the
  // browser's broken-image icon. The tile must fall back to the typed icon
  // instead, exactly as it already does for a document with no picture.
  test("never renders an <img>, even though it carries a src", () => {
    const el = render([
      { id: "inbox:a", name: "clip.mp4", kind: "video", src: "/x/thumb.webp", at: NEW },
    ]);
    expect(el.querySelectorAll("img").length).toBe(0);
    expect(el.textContent).toContain("clip.mp4");
  });
});

describe("newest first", () => {
  test("within a kind, the newer file comes first", () => {
    const el = render([
      { id: "inbox:old", name: "old.csv", kind: "document", bytes: 10, at: OLD },
      { id: "inbox:new", name: "new.csv", kind: "document", bytes: 10, at: NEW },
    ]);
    const names = Array.from(el.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(names[0]).toContain("new.csv");
    expect(names[1]).toContain("old.csv");
  });
});

describe("a document's row", () => {
  test("says its size and its date, not just its name", () => {
    const el = render([
      { id: "inbox:a", name: "trip.gpx", kind: "document", bytes: 3 * 1024, at: NEW },
    ]);
    expect(el.textContent).toContain("trip.gpx");
    expect(el.textContent).toContain("3 KB");
    expect(el.textContent).toContain(new Date(NEW).toLocaleDateString());
  });
});
