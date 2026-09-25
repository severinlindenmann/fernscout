import { createElement, Fragment, type ReactNode } from "react";
import type { ProseNode } from "@/lib/prose";

/**
 * Draws prose `EntryContent` already rendered on the server — see
 * `lib/prose.ts`. The whole of what the story page ships to turn a day's
 * words into elements, in place of a markdown parser.
 *
 * What it will draw is closed on purpose. The tree comes from our own server,
 * but it arrives over the wire, so this is the second layer rather than the
 * only one: only the elements markdown produces are drawn (anything else keeps
 * its text and loses its tag), and no event handler or raw-HTML prop is ever
 * passed through — the same guarantee `EntryContent` gives by having no
 * `rehype-raw`.
 */
export default function Prose({ tree }: { tree: ProseNode }) {
  return draw(tree);
}

/** Every element `EntryContent` can produce from GFM markdown. */
const ALLOWED = new Set([
  "a", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3", "h4",
  "h5", "h6", "hr", "img", "input", "li", "ol", "p", "pre", "section", "span",
  "strong", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

function draw(node: ProseNode): ReactNode {
  if (typeof node === "string") return node;
  const [tag, props, children] = node;
  const drawn = children.map(draw);
  if (!ALLOWED.has(tag)) return createElement(Fragment, null, ...drawn);
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props ?? {})) {
    if (/^on/i.test(key) || key === "dangerouslySetInnerHTML" || key === "ref" || key === "key") continue;
    safe[key] = value;
  }
  // Spread rather than passed as an array, so React sees fixed children and
  // asks for no keys — exactly as it saw them from `react-markdown`.
  return createElement(tag, safe, ...drawn);
}
