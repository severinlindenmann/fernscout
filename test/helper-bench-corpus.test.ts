import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TOOLS } from "@/lib/helper/tools";

/**
 * The corpus is checked by the suite; the corpus's *answers* are not — B1747.
 *
 * `npm run helper:bench` calls a real model and costs money, so it can never
 * be part of `npm run verify`. But the file it reads is ordinary JSON, and
 * everything about it that can be wrong without a model is exactly the kind of
 * thing that rots in a file nobody's tests touch: a tool renamed and a
 * scenario left naming the old one, a wording list emptied, an expectation
 * with nothing in it. A corpus that quietly stopped asserting anything would
 * go on printing a pass rate, and that number is what every prompt decision
 * gets made from.
 *
 * So: shape, ids, and above all **every tool name is a tool that exists**.
 */

const corpus = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "docs/benchmarks/helper-behaviour/corpus.json"), "utf8"),
) as {
  scenarios: {
    id: string;
    why: string;
    channels: string[];
    says: Record<string, (string | string[])[]>;
    world: Record<string, unknown>;
    expect: {
      proposes?: string;
      proposesAnyOf?: string[];
      notProposes?: string[];
      argument?: { name: string; equals: string };
      answerHasNot?: string[];
    };
  }[];
};

const KNOWN_TOOLS = new Set(TOOLS.map((tool) => tool.name));
/** The doors the runner has. A third would need a `run…` function, so a
 *  corpus naming one would silently run nothing. */
const CHANNELS = new Set(["web", "whatsapp"]);

describe("the helper benchmark's corpus", () => {
  test("has scenarios, and every id is unique", () => {
    expect(corpus.scenarios.length).toBeGreaterThan(0);
    const ids = corpus.scenarios.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every tool a scenario names is a tool that exists", () => {
    const named: { id: string; tool: string }[] = [];
    for (const scenario of corpus.scenarios) {
      const { proposes, proposesAnyOf, notProposes } = scenario.expect;
      for (const tool of [proposes, ...(proposesAnyOf ?? []), ...(notProposes ?? [])]) {
        if (tool) named.push({ id: scenario.id, tool });
      }
    }
    expect(named.length).toBeGreaterThan(0);
    const unknown = named.filter((one) => !KNOWN_TOOLS.has(one.tool));
    expect(
      unknown,
      `these scenarios name tools that no longer exist — rename them or delete the scenario, ` +
        `because an expectation on a tool nobody can call passes for the wrong reason: ` +
        unknown.map((one) => `${one.id} -> ${one.tool}`).join(", "),
    ).toEqual([]);
  });

  test("every scenario asserts something", () => {
    for (const scenario of corpus.scenarios) {
      const { proposes, proposesAnyOf, notProposes, answerHasNot } = scenario.expect;
      const asserts =
        proposes !== undefined ||
        (proposesAnyOf?.length ?? 0) > 0 ||
        (notProposes?.length ?? 0) > 0 ||
        (answerHasNot?.length ?? 0) > 0;
      expect(asserts, `${scenario.id} expects nothing, so it passes whatever the model does`).toBe(true);
    }
  });

  test("proposes and proposesAnyOf are alternatives, never both", () => {
    for (const scenario of corpus.scenarios) {
      const both = scenario.expect.proposes !== undefined && (scenario.expect.proposesAnyOf?.length ?? 0) > 0;
      expect(both, `${scenario.id} sets both, and only the first would be read`).toBe(false);
    }
  });

  test("every scenario has a real door, a reason, and wordings to say", () => {
    for (const scenario of corpus.scenarios) {
      expect(scenario.channels.length, `${scenario.id} runs on no channel`).toBeGreaterThan(0);
      for (const channel of scenario.channels) {
        expect(CHANNELS.has(channel), `${scenario.id} names channel "${channel}", which has no runner`).toBe(true);
      }
      // The `why` is not decoration: this corpus is the thing prompt changes
      // are argued from, and a scenario nobody can trace is a number nobody
      // can act on.
      expect(scenario.why.length, `${scenario.id} has no why`).toBeGreaterThan(20);
      const locales = Object.keys(scenario.says);
      expect(locales.length, `${scenario.id} has no wordings`).toBeGreaterThan(0);
      for (const [locale, wordings] of Object.entries(scenario.says)) {
        expect(wordings.length, `${scenario.id}/${locale} has an empty wording list`).toBeGreaterThan(0);
        for (const wording of wordings) {
          const turns = Array.isArray(wording) ? wording : [wording];
          expect(turns.length, `${scenario.id}/${locale} has a conversation with no turns`).toBeGreaterThan(0);
          for (const turn of turns) {
            expect(typeof turn).toBe("string");
            expect(turn.trim(), `${scenario.id}/${locale} has an empty turn`).not.toBe("");
          }
        }
      }
    }
  });

  /**
   * The rule the corpus states about itself, enforced — a placeholder that
   * nothing fills is sent to the model literally, and `{name}` in a message is
   * not a message anybody would send.
   */
  test("every placeholder a wording uses is one the world can fill", () => {
    for (const scenario of corpus.scenarios) {
      const fills = new Set<string>();
      if (scenario.world.share || scenario.world.select || scenario.world.contacts) fills.add("{name}");
      if (scenario.world.trips) fills.add("{trip}");
      for (const [locale, wordings] of Object.entries(scenario.says)) {
        for (const wording of wordings) {
          for (const turn of Array.isArray(wording) ? wording : [wording]) {
            for (const found of turn.match(/\{[a-z]+\}/g) ?? []) {
              expect(fills.has(found), `${scenario.id}/${locale} says ${found}, which this world cannot fill`).toBe(true);
            }
          }
        }
      }
    }
  });
});
