import { describe, expect, test } from "vitest";
import { buildReport, classifyDropReason } from "../scripts/eval-compose/report";
import type { CaseDump, VerdictRecord } from "../scripts/eval-compose/types";

describe("classifyDropReason", () => {
  test("buckets composeGuard's own message shapes", () => {
    expect(classifyDropReason('close: "Old town" cites unknown n9')).toBe("unknown source id");
    expect(classifyDropReason('story: "At 09:30" clock time 09:30 not in a cited note')).toBe("clock time not in notes");
    expect(classifyDropReason('close: "14 Euro" number 14 not in its sources')).toBe("ungrounded number");
    expect(classifyDropReason('story: banned "unforgettable"')).toBe("banned phrase");
    expect(classifyDropReason('close: "we" but the writer travels alone')).toBe('unwarranted "we"');
    expect(classifyDropReason("story: 90 words, at most 75")).toBe("too long");
    expect(classifyDropReason('title "Old Town" not grounded in the day')).toBe("title not grounded");
    expect(classifyDropReason("story: notes under 25 words")).toBe("story too thin");
    expect(classifyDropReason("some never-before-seen reason")).toBe("other");
  });
});

function dump(overrides: Partial<CaseDump> = {}): CaseDump {
  return {
    caseId: "c1",
    label: "trip 2026-01-01",
    source: "hard",
    model: "claude-sonnet-5",
    notes: ["went to the market"],
    pack: {},
    ok: true,
    dropped: [],
    variants: [{ slot: "close", titles: [], text: "Went to the market.", sentences: [{ text: "Went to the market.", sources: ["n1"] }], bannedPhraseHits: [] }],
    tags: [],
    missing: [],
    latencyMs: 1200,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    ...overrides,
  };
}

describe("buildReport", () => {
  test("reports pass rates from verdicts, and says so when there are none yet", () => {
    const noVerdicts = buildReport({ cases: [dump()], verdicts: [] });
    expect(noVerdicts).toContain("No `verdicts.jsonl` yet");

    const verdict: VerdictRecord = {
      caseId: "c1",
      variant: "close",
      grounding: { pass: true, claims: [{ text: "went to the market", sourceId: "n1" }] },
      endsWithSummingUp: false,
      wouldPublish: { pass: true, critique: "fine as is" },
    };
    const withVerdicts = buildReport({ cases: [dump()], verdicts: [verdict] });
    expect(withVerdicts).toContain("| (all) | 1 | 100% | 100% | 100% |");
  });

  test("the deterministic banned-phrase count never needs a judge", () => {
    const report = buildReport({
      cases: [dump({ variants: [{ slot: "close", titles: [], text: "truly unforgettable", sentences: [], bannedPhraseHits: ["truly", "unforgettable"] }] })],
      verdicts: [],
    });
    expect(report).toContain("1 of 1 variants used a banned phrase");
  });

  test("lists a case with drops among the worst cases", () => {
    const report = buildReport({ cases: [dump({ dropped: ["close: banned \"truly\""] })], verdicts: [] });
    expect(report).toContain("## Worst cases");
    expect(report).toContain("c1");
  });
});
