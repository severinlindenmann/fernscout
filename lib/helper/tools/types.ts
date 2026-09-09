import type { Block, Proposal, ProposalField, Shape } from "../blocks";
import type { Say } from "../intents";

/**
 * What a tool is — B898, and what a proposal is — B900.
 *
 * The contract, and nothing that uses it. It sits alone in this file so that
 * an area file can say what shape it is filling in without dragging the whole
 * registry, and so that the one place the union is defined is findable by its
 * own name (B1042 split `tools.ts`; before that this lived nine hundred lines
 * above the tools it describes).
 */
/** What a tool declares it takes. Strings only: the model fills these in, and
 *  a number it wrote is a string it wrote about a number. */
type Properties = Record<string, { type: "string"; description: string }>;

type Named = {
  name: string;
  /** The sentence the model reads when deciding whether to call it. */
  describe: string;
  properties: Properties;
};
/** What a `propose` hands back. Nothing in it has happened. */
type Proposed = {
  sentence: string;
  fields: ProposalField[];
  /** The word on the button — what it does, never "OK" (B633). */
  accept: string;
  /** What the conversation says once the press has gone through. */
  done: string;
  /**
   * The thing as it stands, drawn *before* the press.
   *
   * `publish_day` is why this exists and it is not optional there: a day goes
   * on the site after somebody has read it back, so the proposal renders the
   * day and then the one button. It never fires from a sentence.
   */
  preview?: string[];
  /**
   * The tool declining itself, in words — B951.
   *
   * A translation key. `proposalFor` returns this sentence and no proposal, so
   * there is no button and the model is told what to say instead.
   *
   * The existing way to propose nothing is to leave a required field empty,
   * and it answers only one question — *which* day, *which* trip. This
   * answers the other one: the day is right and its **state** is wrong.
   * Asking to take down a day that is still a draft produced a card saying it
   * *"comes off the site"*, about a day that had never been on it. Nothing
   * was written, because `POST .../day/unpublish` refuses with
   * `already_draft` — but the sentence a person read before pressing was
   * false about their own journal, which is B944's fault one step earlier.
   */
  refuse?: string;
  /**
   * The proposal that opens after this one is pressed — B969, and it is here
   * rather than only on the tool because whether there *is* a next one can
   * depend on what was said.
   *
   * `start_day` chains to `draft_words` when somebody gave it a day's worth of
   * notes, and to nothing when they did not: offering to write up an empty day
   * would be a card asking to spend a credit on nothing.
   */
  next?: { tool: string; from: Record<string, string> };
};
export type Tool = Named &
  (
    | {
        kind: "read";
        renders: Shape;
        run: (username: string, args: Record<string, string>) => Promise<unknown>;
        /**
         * How the result is drawn. Absent **only** when `renders` is `say`:
         * prose is the model's own sentence and there is nothing extra to
         * put on the screen beside it. `test/helper-tools.test.ts` fails on
         * any other tool that omits it.
         */
        block?: (data: unknown, say: Say) => Block | null;
      }
    | {
        kind: "write";
        renders: "form" | "confirm";
        propose: (
          username: string,
          args: Record<string, string>,
          say: Say,
          /** The person's own today, from their browser — "yesterday" is
           *  answered from where they are standing, not from the server. */
          today: string,
          /**
           * What is ticked in the files pane, as the browser sends it — B925.
           *
           * A tool that needs the selection reads it here rather than asking
           * the person for ids they cannot see. Most tools declare four
           * parameters and ignore this one, which is what a narrower function
           * signature is allowed to do.
           */
          selected: string[],
        ) => Promise<Proposed>;
        /** The helper route the press posts to — never `/api/v1`, never a
         *  route that deletes. `test/helper-tools.test.ts` asserts the list. */
        endpoint: (username: string) => string;
        method?: "PATCH";
        /** The proposal that opens next, carrying what came back — see
         *  `Proposal.next` in `./blocks.ts`. */
        next?: { tool: string; from: Record<string, string> };
      }
    | {
        kind: "link";
        renders: "link";
        link: (
          username: string,
          args: Record<string, string>,
          say: Say,
        ) => { text: string; href: string; label: string };
      }
  );


export type { Block, Proposal, ProposalField, Shape, Say };
