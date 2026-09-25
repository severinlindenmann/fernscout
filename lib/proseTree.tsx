import "server-only";
import { Fragment, isValidElement, type ReactNode } from "react";
import EntryContent from "@/components/EntryContent";
import { contentFor, type DayProse, type ProseNode, type ProseProps, type StoryDay } from "./prose";
import type { Day } from "./types";

/**
 * `EntryContent`'s output for one piece of markdown, as `ProseNode` data —
 * see `lib/prose.ts` for why the story page's prose is drawn here.
 *
 * It calls `EntryContent` and walks the elements that come back rather than
 * running the markdown pipeline a second way, so there is one rendering of a
 * reader's prose and not two to keep in step: the same remark plugins, the
 * same `urlTransform` on every link and image, raw HTML in the markdown
 * shown as text exactly as `react-markdown` shows it, the same wide-table
 * wrapper. Every component in that tree is a plain synchronous function of
 * its props — `EntryContent`, `Markdown`, `ScrollingTable` — so walking it is
 * calling them; anything else is refused loudly rather than guessed at.
 */
export function proseTree(markdown: string): ProseNode {
  const nodes = walk(<EntryContent markdown={markdown} />);
  // `EntryContent` draws exactly one wrapper element.
  if (nodes.length !== 1) throw new Error("EntryContent should render one element");
  return nodes[0];
}

function walk(node: ReactNode): ProseNode[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!isValidElement(node)) throw new Error(`Unexpected node in rendered prose: ${typeof node}`);

  const { type } = node;
  const props = node.props as Record<string, unknown> & { children?: ReactNode };
  if (type === Fragment) return walk(props.children);
  if (typeof type === "function") {
    // A plain function component — see above. A class component or a hook
    // would throw here, which is the point: it would be a component this
    // walk does not know how to render faithfully.
    return walk((type as (p: unknown) => ReactNode)(props));
  }
  if (typeof type !== "string") throw new Error("Unexpected element type in rendered prose");

  const out: ProseProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (key === "style" && typeof value === "object") {
      // A table cell's alignment, `{ textAlign: "center" }`.
      out.style = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
      );
    } else {
      throw new Error(`Unexpected prop ${key} on <${type}> in rendered prose`);
    }
  }
  return [[type, Object.keys(out).length > 0 ? out : null, walk(props.children)]];
}

/**
 * The window's days with their prose drawn, in the language `locale` reads
 * them in — the same choice `LocaleProvider.localized` makes for the title,
 * through the same `contentFor`.
 */
export function withProse(days: Day[], locale: string, writtenLocale: string): StoryDay[] {
  return days.map((day) => {
    const prose: DayProse = {};
    for (const entry of day.entries) {
      prose[entry.slug] = proseTree(contentFor(entry, locale, writtenLocale));
    }
    return { ...day, prose };
  });
}
