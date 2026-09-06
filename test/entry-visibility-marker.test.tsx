import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import EntryVisibilityBadge from "@/components/EntryVisibilityBadge";
import { dictionaryFor } from "@/lib/locales";

/**
 * B632 — the sibling of `test/photo-visibility-marker.test.tsx`: a held-back
 * update needs to say so to the one audience allowed to notice, or nobody can
 * check that the label actually landed. `visible()` in lib/entries.ts is what
 * makes the entry absent below its level — covered end to end by
 * `test/entry-visibility.test.ts` — this is the other half, the marker for a
 * reader who may see the update at all.
 */

function markup(visibility: "guest" | "private" | undefined, reader: "public" | "guest" | "person") {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <EntryVisibilityBadge visibility={visibility} reader={reader} />
    </LocaleProvider>,
  );
}

describe("a held-back update, as the badge draws it", () => {
  test("nothing renders for an unlabelled update, at any reader level", () => {
    expect(markup(undefined, "person")).not.toContain("Private");
    expect(markup(undefined, "person")).not.toContain("Guest");
  });

  test("nothing renders below person level — a guest reader sees no marker on their own update", () => {
    expect(markup("guest", "public")).toBe("");
    expect(markup("guest", "guest")).toBe("");
  });

  test("the owner or a traveller sees the marker, matching the label", () => {
    expect(markup("guest", "person")).toContain("Guest");
    expect(markup("private", "person")).toContain("Private");
  });
});
