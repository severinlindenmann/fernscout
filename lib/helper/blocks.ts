/**
 * The seven shapes a tool may render into — B898, round 1 of
 * `docs/plans/2026-09-08-the-chat-is-the-product.md`.
 *
 * **A tool declares how its result looks. The model chooses tools and never
 * chooses a shape.** That is the whole safety argument in one sentence: the
 * model cannot ask for a component nobody built, a new capability is one tool
 * with one declared shape, and every shape is testable before a person sees
 * it. Adding an eighth needs an argument, and the argument is in the plan.
 *
 * **No `import "server-only"` here, deliberately.** This is the one file the
 * conversation surface and the tool registry both read: the client needs the
 * union to draw a block and the server needs it to build one. Everything that
 * can *do* anything lives in `./tools.ts`, which is server-only; this is types
 * and one array of strings.
 *
 * **Every block carries `text`.** A shape the client has not learned to draw
 * yet still has a sentence to fall back on, which is what keeps a new shape
 * from rendering as a blank space in somebody's journal.
 */

/** The seven. The client renders each of these; nothing else is a shape. */
export const SHAPES = [
  "say",
  "choose",
  "form",
  "preview",
  "files",
  "confirm",
  "link",
] as const;

export type Shape = (typeof SHAPES)[number];

/** One thing to pick from in a `choose`. `value` is what a later turn names. */
type Option = { value: string; label: string; detail?: string };

/** One field of a proposal, prefilled and editable. Never applied silently. */
export type ProposalField = { name: string; value: string; date?: boolean };

/** What a tool's result looks like on the screen. */
export type Block =
  | { shape: "say"; text: string }
  | { shape: "choose"; text: string; options: Option[] }
  | { shape: "form"; text: string; fields: ProposalField[] }
  | { shape: "preview"; text: string; lines: string[] }
  | { shape: "files"; text: string; files: { id: string; name: string }[] }
  | { shape: "confirm"; text: string }
  | { shape: "link"; text: string; href: string; label: string };

/**
 * What a write tool returns instead of writing.
 *
 * The tool it came from, the arguments filled in, and a sentence saying what
 * will happen — in the person's own language, because the sentence is
 * translated by the route that has the locale rather than composed by a tool
 * that does not. Accepting one is B900; until then this is produced, rendered
 * and pressed on by nobody.
 */
export type Proposal = {
  tool: string;
  arguments: Record<string, string>;
  sentence: string;
  fields: ProposalField[];
};
