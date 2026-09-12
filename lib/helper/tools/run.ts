import "server-only";
import type { Block, Proposal, ProposalField, Say, Shape, Tool } from "./types";
import { TOOLS } from "./registry";
import { isPreviewOnly } from "../intents";

/**
 * Running one tool, and building the proposal a press posts — B898, B900.
 *
 * The half of the old `tools.ts` that is not tools. It knows the contract and
 * the registry and nothing about any particular capability, which is what
 * makes it the right place for the rules that hold for all of them: a write
 * tool never writes, a proposal that cannot be pressed is not offered, and
 * `arguments` is one representation of one call.
 */
/** The list the model is shown, generated — because a hand-written menu goes
 *  stale the first afternoon. A write tool says so in its own `describe`, so
 *  the menu is honest about which of these end in a press. */
export function toolList(): string {
  return TOOLS.map((tool) => `- ${tool.name}: ${tool.describe}`).join("\n");
}

/** The same registry, as the arguments schemas the SDK wants. Kept here
 *  rather than in `./model.ts` so there is one place a tool is described.
 *  Takes a subset — the chosen area's tools, B1053 — and defaults to the
 *  whole registry for callers that still want it (the honesty tests, the
 *  ceiling test's own worst case). */
export function toolSchemas(tools: readonly Tool[] = TOOLS) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.describe,
    input_schema: {
      type: "object" as const,
      properties: tool.properties as Record<string, unknown>,
      required: [] as string[],
      additionalProperties: false,
    },
  }));
}

/** What one tool call produced: what the model reads, and what the person
 *  sees. A `say` read draws nothing of its own — the sentence is the model's. */
export type Ran = {
  ok: boolean;
  result: unknown;
  blocks: Block[];
  proposal?: Proposal;
  /** This call's blocks are a tool declining itself — B1299. Set only by
   *  a write tool's own `refuse` (see `proposalFor`), so the round loop
   *  that runs tools knows which say blocks are held-back refusals rather
   *  than ordinary content. */
  refused?: boolean;
};

/** The declared arguments, trimmed, with anything the tool did not declare
 *  dropped rather than shown to somebody as a prefilled field. */
function argumentsOf(tool: Tool, args: unknown): Record<string, string> {
  const given = (args ?? {}) as Record<string, unknown>;
  const strings: Record<string, string> = {};
  for (const key of Object.keys(tool.properties)) {
    const value = given[key];
    if (typeof value === "string" && value.trim() !== "") strings[key] = value.trim();
  }
  return strings;
}

/**
 * One write tool's proposal — B900, and **nothing here writes**.
 *
 * Exported because a proposal is asked for twice: once by the model, when it
 * decides a sentence means a write, and once by `POST .../proposal` when one
 * accepted write hands on to the next (`draft_words` → `set_day_words`). Both
 * end in the same fields on the same screen with the same button, which is
 * what stops a chain being a second, quieter way to write something.
 */
export async function proposalFor(
  username: string,
  tool: Extract<Tool, { kind: "write" }>,
  args: Record<string, string>,
  say: Say,
  today: string,
  selected: string[] = [],
  /** The sentence that led here, when there is one to check — B1562. Only
   *  `publish_day` reads it, and only to refuse being offered from a
   *  preview-only sentence; every other tool ignores it, so a caller that
   *  never passes one (the proposal-chain route) behaves exactly as before. */
  said = "",
): Promise<{ proposal?: Proposal; blocks: Block[]; refused?: boolean }> {
  const made = await tool.propose(username, args, say, today, selected);

  /**
   * **A proposal that cannot work is not offered** — B925, and B920's rule
   * applied to this side of the screen.
   *
   * Every route a press posts to needs the trip, the day and — for an attach
   * — the files. A field left empty because nothing resolved used to be
   * proposed anyway: the button was there, the sentence said the photographs
   * were going onto the day, and the press came back `unknown_day` with the
   * files still in the inbox. One check, in the one place every proposal is
   * built, so a tool cannot forget it: no button, and a sentence saying which
   * half is missing.
   */
  // The tool declining itself — B951, and it comes first: a day that is
  // already a draft is a better answer than "which day did you mean".
  //
  // `refused: true` travels with the block — B1299. `trip_people` can be
  // called speculatively ("maybe my partner should go on the byline?") and
  // recover on its own later in the same turn with a different tool; the
  // round loop in `model.ts` holds a refusal back rather than showing it
  // immediately, and drops it if anything after it succeeds.
  if (made.refuse) {
    return {
      blocks: [{ shape: "say", text: say(made.refuse as Parameters<Say>[0]) }],
      refused: true,
    };
  }

  const empty = (name: string) => made.fields.some((field) => field.name === name && field.value.trim() === "");
  const missing = empty("trip")
    ? "agent.tool.noTrip"
    : empty("slug")
      ? "agent.tool.noDay"
      : empty("files")
        ? "agent.tool.noFiles"
        : "";
  if (missing !== "") {
    return { blocks: [{ shape: "say", text: say(missing) }] };
  }

  /**
   * **A preview request is not a publish button** — B1562. "vorschau" drew a
   * `publish_day` card whose button publishes; the person read the sentence
   * "read this the way your readers will" as consent to see it, and pressed.
   *
   * The day it would have shown is what `made.preview` already carries, so it
   * is drawn here — under `read_day`'s own caption, never `made.sentence`,
   * which is written to sit above a button ("Pressing puts it on the site")
   * that this card does not have. No proposal is what tells `runTool` there
   * is nothing to press.
   */
  if (tool.name === "publish_day" && isPreviewOnly(said)) {
    const blocks: Block[] = [];
    if (made.preview && made.preview.length > 0) {
      blocks.push({ shape: "preview", text: say("agent.block.day"), lines: made.preview });
    }
    return { blocks };
  }

  const proposal: Proposal = {
    tool: tool.name,
    /**
     * **One representation of one call** — B935, B936.
     *
     * `arguments` used to be what the model typed and `fields` what the server
     * resolved, and the two disagreed the moment a tool did any work: the
     * trip arrived as *"Spaziergang am See"* where the route needs
     * `spaziergang-am-see-2026`, and `start_day`'s own questions (B917) were
     * on the card and in no argument at all. Pressing a proposal the way its
     * own `arguments` describe it came back `unknown_trip` or
     * `incomplete_day`; the browser only survived it because `HelperAsk`
     * merged the fields back in on the way out.
     *
     * So the fields win here, once, where every proposal is built: **what a
     * press sends is `arguments`**, resolved and complete, and `fields` is
     * the same call shown for correction rather than a second source of
     * truth. An argument no field carries — a `date` a slug already answers —
     * stays, because a field that is not drawn has nothing to say about it.
     *
     * `test/helper-proposal-arguments.test.ts` presses every write tool in
     * the registry with `arguments` and nothing else.
     */
    arguments: {
      ...args,
      ...Object.fromEntries(made.fields.map((field) => [field.name, field.value])),
    },
    sentence: made.sentence,
    fields: made.fields,
    endpoint: tool.endpoint(username),
    method: tool.method ?? "POST",
    accept: made.accept,
    done: made.done,
    // The proposal's own, then the tool's — B969.
    ...(made.next ?? tool.next ? { next: made.next ?? tool.next } : {}),
  };
  const blocks: Block[] = [];
  // The thing as it stands, and then the press — never the other way round.
  if (made.preview && made.preview.length > 0) {
    blocks.push({ shape: "preview", text: made.sentence, lines: made.preview });
  }
  blocks.push(
    tool.renders === "form"
      ? { shape: "form", text: made.sentence, fields: made.fields, proposal }
      : {
          shape: "confirm",
          text: made.sentence,
          // Only what has to be chosen — B929. `trip` and `slug` stay the
          // server's own answer about which day this is about.
          fields: made.fields.filter((field) => field.options),
          proposal,
        },
  );
  return { proposal, blocks };
}

/** The write tool of that name, or null — the propose route's own lookup, so
 *  a `next` naming a read or a tool nobody built lands nowhere. */
export function writeTool(name: string): Extract<Tool, { kind: "write" }> | null {
  const tool = TOOLS.find((one) => one.name === name);
  return tool && tool.kind === "write" ? tool : null;
}

/**
 * Run one tool the model asked for.
 *
 * An unknown name and a thrown read both come back as a value the model can
 * read rather than as an exception: a tool that fails is a fact about the
 * journal ("there are no trips"), and the turn should end in a sentence about
 * it rather than in a 502.
 *
 * `say` is passed in rather than imported so that a proposal's sentence and a
 * block's heading are in the reader's own language and this file holds no
 * English prose.
 */
export async function runTool(
  username: string,
  name: string,
  args: unknown,
  say: Say,
  today: string,
  /** What is ticked in the files pane — B925, resolved by the tool that needs
   *  it rather than read out to the model by a person. */
  selected: string[] = [],
  /** The sentence that led here — B1562. Threaded through to `proposalFor`,
   *  which is the only thing that reads it. */
  said = "",
): Promise<Ran> {
  const tool = TOOLS.find((one) => one.name === name);
  if (!tool) {
    return { ok: false, result: { error: `there is no tool called ${name}` }, blocks: [] };
  }
  const strings = argumentsOf(tool, args);

  if (tool.kind === "write") {
    // Nothing is executed. `propose` may read this journal to fill a field in
    // or to draw the day; there is no `run` on a write tool to call, and the
    // press is what posts to `endpoint`.
    const { proposal, blocks, refused } = await proposalFor(username, tool, strings, say, today, selected, said);
    if (!proposal) {
      // Nothing resolved, so there is nothing to press — and the model is told
      // so in the same words the person is, rather than being left to say a
      // button is waiting further down the page (B920).
      return {
        // Not an error: the tool answered, and what it answered is that there
        // is nothing to propose. `ok: false` would be `is_error` on the model's
        // tool result, and this is a fact about the journal rather than a fault.
        ok: true,
        result: {
          proposed: false,
          wrote: false,
          tool: tool.name,
          why:
            tool.name === "publish_day" && isPreviewOnly(said)
              ? "they asked to see the day, not to publish it, so nothing was proposed — describe what the preview block shows and say publishing needs asking for by name"
              : "nothing was proposed and there is no button on their screen: say so, and ask which trip or which day they mean",
        },
        blocks,
        refused,
      };
    }
    return {
      ok: true,
      // What the model reads back, so its own sentence can say a proposal is
      // waiting rather than claim the thing exists.
      result: { proposed: true, wrote: false, tool: tool.name, arguments: proposal.arguments },
      blocks,
      proposal,
    };
  }

  if (tool.kind === "link") {
    const { text, href, label } = tool.link(username, strings, say);
    return {
      ok: true,
      result: { link: href, wrote: false },
      blocks: [{ shape: "link", text, href, label }],
    };
  }

  try {
    const result = await tool.run(username, strings);
    const block = tool.block?.(result, say) ?? null;
    return { ok: true, result, blocks: block ? [block] : [] };
  } catch (thrown) {
    return { ok: false, result: { error: (thrown as Error).message }, blocks: [] };
  }
}

