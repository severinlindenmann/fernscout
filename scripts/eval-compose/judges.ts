/**
 * Judging a composed day — B2692.
 *
 * API credit is scarce, so the default is to judge for free: `dumpCase`
 * (in `runner.ts`) writes every case's output to `cases.jsonl`, this file's
 * `JUDGE_INSTRUCTIONS` goes beside it as `judge-instructions.md`, and a
 * person or a subagent reads both and writes `verdicts.jsonl` by hand — no
 * network call, no cost. `report.mts` then merges that file into
 * `report.md` with no model call either.
 *
 * `EVAL_JUDGE=api` turns the same three rubrics into real model calls
 * (`judgeVariant` below, on a cheaper model than the composer —
 * `modelFor("small")` by default) when the owner has actual credit to
 * spend on judging too. Off by default; `run.mts` is the only caller.
 *
 * The deterministic part — banned/machine phrases — is never a judge's
 * job either way: `bannedPhraseCheck` just re-runs `composeGuard`'s own
 * regex (already checked inside `composeDay` before a variant is ever
 * returned) so `cases.jsonl` carries the answer for free.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { bannedHits } from "../../lib/helper/composeGuard";
import { modelFor } from "../../lib/helper/models";
import type { VerdictRecord } from "./types";

export function bannedPhraseCheck(text: string, languages: string[], notes: string): { pass: boolean; hits: string[] } {
  const hits = bannedHits(text, languages, notes);
  return { pass: hits.length === 0, hits };
}

/** What `judge-instructions.md` tells a person or subagent to do, and what
 *  `judgeVariant` below asks the model instead. Same rubric either way —
 *  the point of B2692 is that a prompt change can be judged consistently,
 *  not that a human and a model agree with each other. */
export function judgeRubricMarkdown(): string {
  return `# Compose eval — judge rubrics

For every case in \`cases.jsonl\`, for every variant it carries (\`close\`,
and \`story\` when present), write one line of JSON to \`verdicts.jsonl\`
matching exactly:

\`\`\`json
{"caseId": "...", "variant": "close", "grounding": {"pass": true, "claims": [{"text": "...", "sourceId": "n1"}]}, "endsWithSummingUp": false, "wouldPublish": {"pass": true, "critique": "..."}}
\`\`\`

A case's \`bannedPhraseHits\` is already checked in code (regex, per
locale) — never re-check it; it is in \`cases.jsonl\` for your own
reference only.

## 1. Grounding

List every factual claim in the variant's \`text\` — a place, a person, an
action, a food, a time, a number, the weather, a feeling; anything a reader
could believe actually happened. For each, give the \`sources\` id from the
sentence it came from if that id's own text (in \`pack\`) actually supports
the claim, or \`"UNSUPPORTED"\` if it does not — a sentence can cite a real
id and still claim something that id's text does not say.

\`grounding.pass\` is true **iff no claim is \`"UNSUPPORTED"\`.**

Why: a sentence passing the code's own word-stem guard is not the same as
the *claim* being true — "the castle was closed" and "the castle might be
closed" share every stem, and only one of them is what a source said.

## 2. Ending

Read the variant's last sentence. \`endsWithSummingUp\` is true iff it is a
line stepping back to say what the day meant, felt like, or taught — rather
than the last concrete thing that happened. ("A good end to a strange day."
is a summing-up line; "We got back after midnight." is not, even as a last
line.)

## 3. Would the writer publish this?

Read \`notes\` (their own words) and the variant's \`text\` side by side.
\`wouldPublish.pass\` is true iff the writer would keep this with at most
light edits — not whether it reads well in the abstract. \`critique\` is one
line: why, or what is wrong.
`;
}

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    grounding: {
      type: "object",
      properties: {
        pass: { type: "boolean" },
        claims: {
          type: "array",
          items: {
            type: "object",
            properties: { text: { type: "string" }, sourceId: { type: "string" } },
            required: ["text", "sourceId"],
            additionalProperties: false,
          },
        },
      },
      required: ["pass", "claims"],
      additionalProperties: false,
    },
    endsWithSummingUp: { type: "boolean" },
    wouldPublish: {
      type: "object",
      properties: { pass: { type: "boolean" }, critique: { type: "string" } },
      required: ["pass", "critique"],
      additionalProperties: false,
    },
  },
  required: ["grounding", "endsWithSummingUp", "wouldPublish"],
  additionalProperties: false,
} as const;

/** `EVAL_JUDGE=api` only. One model call, one variant, all three rubrics
 *  (grounding/ending/would-publish) in one structured answer — the same
 *  three fields a person fills in by hand per `judgeRubricMarkdown`. */
export async function judgeVariant(opts: {
  caseId: string;
  variant: "close" | "story";
  notes: string[];
  packXml: string;
  text: string;
  model?: string;
}): Promise<VerdictRecord> {
  const model = opts.model ?? process.env.EVAL_JUDGE_MODEL?.trim() ?? modelFor("small");
  const client = new Anthropic();
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    system: judgeRubricMarkdown(),
    messages: [
      {
        role: "user",
        content: `<pack>${opts.packXml}</pack>\n<notes>${opts.notes.join("\n")}</notes>\n<variant>${opts.text}</variant>\n\nJudge this one variant per the rubrics in the system prompt. Answer with the JSON object only.`,
      },
    ],
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
  });
  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  const parsed = JSON.parse(raw) as Omit<VerdictRecord, "caseId" | "variant">;
  return { caseId: opts.caseId, variant: opts.variant, ...parsed };
}
