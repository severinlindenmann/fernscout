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

/**
 * One field of a proposal, prefilled and **editable** — B900.
 *
 * Editable is the whole of it: a proposal a person can only accept or refuse
 * is a form with one button, and the thing that makes this a conversation is
 * that a wrong field can be corrected either by typing over it or by saying
 * what is wrong and letting the next turn propose again.
 *
 * `date`, `long` and `options` are the three native inputs the browser
 * already has — `type="date"`, a textarea and a `<select>` — rather than
 * three widgets somebody would have to build and then make reachable.
 */
export type ProposalField = {
  name: string;
  value: string;
  date?: boolean;
  /** Prose. Drawn as a textarea rather than a one-line box. */
  long?: boolean;
  /** A closed list. Drawn as a select, so the words are read before choosing
   *  — this is how a trip's visibility is asked rather than defaulted. */
  options?: { value: string; label: string }[];
};

/** What a tool's result looks like on the screen. */
export type Block =
  | { shape: "say"; text: string }
  | { shape: "choose"; text: string; options: Option[] }
  | { shape: "form"; text: string; fields: ProposalField[]; proposal?: Proposal }
  | { shape: "preview"; text: string; lines: string[] }
  | { shape: "files"; text: string; files: { id: string; name: string }[] }
  /**
   * A press, and — since B929 — the questions that press cannot go through
   * without. A confirmation has no editable fields on purpose (there is
   * nothing to correct about *which* day: saying the right one proposes it
   * again), but a trip's own question is not a correction, it is the answer
   * the route will refuse without. Only fields carrying `options` are drawn,
   * so a confirmation can ask and still never turn into a form.
   */
  | { shape: "confirm"; text: string; fields?: ProposalField[]; proposal?: Proposal }
  | { shape: "link"; text: string; href: string; label: string };

/**
 * What a write tool returns instead of writing.
 *
 * The tool it came from, the arguments filled in, a sentence saying what will
 * happen, and — since B900 — **where the press goes**: an existing helper
 * route, named by the registry rather than known to the client. That is what
 * keeps "adding a tool needs no client change" true while a proposal can now
 * actually be accepted: the browser posts what it is told to post, to a route
 * that validates and refuses exactly as it does for the wizard, and there is
 * no second path to disk anywhere in this feature.
 *
 * Nothing here has happened yet. A proposal that is corrected, argued with or
 * abandoned costs nothing at all; what a write costs is charged by the route
 * it posts to, on the press, once.
 */
export type Proposal = {
  tool: string;
  arguments: Record<string, string>;
  sentence: string;
  fields: ProposalField[];
  /** The helper route the press posts to. Absolute path, username already in
   *  it, chosen by the registry — the client never composes one. */
  endpoint: string;
  method: "POST" | "PATCH";
  /** The word on the button, saying what it does rather than "OK" (B633). */
  accept: string;
  /** What the conversation says once it has actually happened. */
  done: string;
  /**
   * The proposal that opens next, carrying what came back.
   *
   * One chain exists and it is the reason this is here: asking the model for
   * a day's words returns prose and writes nothing, so the words then have to
   * be *kept*, which is a second write and a second press. The person reads
   * what came back before either.
   *
   * `from` maps a path in the first route's answer to an argument of the next
   * tool. **Data rather than a function**, because the client is what applies
   * it and the client must stay ignorant of every particular tool — this is
   * the same reason `endpoint` is here rather than in a table in the browser.
   */
  next?: { tool: string; from: Record<string, string> };
};
