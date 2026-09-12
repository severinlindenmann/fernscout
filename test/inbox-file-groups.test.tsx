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
 * This proves the component's own claims in isolation: photographs and
 * documents land in different groups, each group is newest first, and a
 * document row carries its size and date rather than nothing at all.
 * `test/helper-room.test.tsx` checks the wiring into `HelperRoom.tsx` itself.
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

  /**
   * B1572 — a long, unbreakable filename used to push the whole row (and
   * with it the "Dateien" tab) into horizontal scroll: `truncate` on the
   * name span only clips when its flex-item ancestor can shrink, and a flex
   * item's default `min-width: auto` refuses to shrink below the width of
   * unbroken text. jsdom has no layout, so this asserts the class that makes
   * the row shrinkable (`min-w-0` on the row's own flex item, the `<label>`)
   * rather than a pixel width.
   */
  test("the row itself can shrink below its filename's own width", () => {
    const el = render([
      {
        id: "inbox:a",
        name: "a-genuinely-extremely-long-account-statement-filename-that-would-otherwise-refuse-to-shrink.csv",
        kind: "document",
        bytes: 1024,
        at: NEW,
      },
    ]);
    const label = el.querySelector("label[data-inbox-id='inbox:a']");
    expect(label?.className).toMatch(/\bmin-w-0\b/);
  });
});

describe("a day folder's staged content", () => {
  // Phase 2 (inbox day-assembly), Task 4: a date-keyed group, above the
  // undated ones, naming the date rather than "Photographs"/"Documents"/
  // "Other" — so a person can see *that* something staged for a day exists,
  // which is the whole point of this ticket.
  test("groups under a heading naming its own date, above the undated groups", () => {
    const el = render([
      { id: "inbox:a", name: "old-undated.csv", kind: "document", bytes: 10, at: OLD },
      { id: "inbox:b", name: "pin.json", kind: "location", date: "2026-01-01" },
    ]);
    expect(el.textContent).toContain("2026-01-01");
    expect(el.textContent).toContain("pin.json");
    const headings = [...el.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings[0]).toBe("2026-01-01");
  });

  test("two dated items for the same date land in one group, not two", () => {
    const el = render([
      { id: "inbox:a", name: "pin.json", kind: "location", date: "2026-01-01" },
      { id: "inbox:b", name: "harbour.jpg", kind: "photo", date: "2026-01-01" },
    ]);
    const headings = [...el.querySelectorAll("h3")].filter((h) => h.textContent === "2026-01-01");
    expect(headings.length).toBe(1);
  });

  // Final-review fix: `discard_file` and the discard route both resolve an
  // id through `findInboxFile`, which only ever searches the flat bucket —
  // pressed on a dated row it either does nothing or 404s. Full day-folder
  // discard is Phase 3's job; until then a dated row renders with no ×
  // rather than one that looks like it works.
  test("a dated row has no discard button, unlike an undated one", () => {
    const el = render([
      { id: "inbox:a", name: "old-undated.csv", kind: "document", bytes: 10, at: OLD },
      { id: "inbox:b", name: "pin.json", kind: "location", date: "2026-01-01" },
    ]);
    const rows = [...el.querySelectorAll("li")];
    const datedRow = rows.find((li) => li.textContent?.includes("pin.json"));
    const undatedRow = rows.find((li) => li.textContent?.includes("old-undated.csv"));
    expect(datedRow?.querySelector("button")).toBeNull();
    expect(undatedRow?.querySelector("button")).not.toBeNull();
  });

  // Same fix: the thumbnail route 404s for a dated media item too (latent
  // today — only location pins are dated so far), so a dated photo must not
  // carry a `src` even if `kind` says photo.
  test("a dated photo does not render an <img>, even if it carries a src", () => {
    const el = render([
      { id: "inbox:a", name: "harbour.jpg", kind: "photo", date: "2026-01-01", src: "/x/thumb.webp" },
    ]);
    expect(el.querySelectorAll("img").length).toBe(0);
  });
});

describe("a location or contact item", () => {
  test("renders its own icon rather than the generic document one", () => {
    const el = render([
      { id: "inbox:a", name: "Zermatt", kind: "location", at: NEW },
      { id: "inbox:b", name: "maria.vcf", kind: "contact", at: NEW },
    ]);
    expect(el.textContent).toContain("Zermatt");
    expect(el.textContent).toContain("maria.vcf");
  });
});
