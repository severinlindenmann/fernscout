// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import Gallery from "@/components/Gallery";
import type { GalleryItem } from "@/lib/types";

/**
 * B1867, the half the entries suite cannot see: that the sentence actually
 * lands on the element a screen reader reads.
 *
 * `alt ?? caption ?? ""` in seven components is three claims — described wins,
 * a caption still answers when nothing has described the picture, and neither
 * one ever renders the word "undefined" — and only a rendered `<img>` proves
 * any of them.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(items: GalleryItem[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <Gallery items={items} />
      </LocaleProvider>,
    );
  });
  return [...container.querySelectorAll("img")].map((img) => img.getAttribute("alt"));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

test("a described photograph is announced by what it shows, not by its caption", () => {
  const alts = render([
    { src: "/a/media/t/d/01.jpg", type: "image", caption: "A caption", alt: "A grey rectangle." },
    { src: "/a/media/t/d/02.jpg", type: "image", caption: "A caption" },
    { src: "/a/media/t/d/03.jpg", type: "image" },
  ]);

  expect(alts).toEqual(["A grey rectangle.", "A caption", ""]);
});
