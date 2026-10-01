"use client";

import type { DayGroup } from "@/lib/extract/group";
import type { Question } from "@/lib/extract/questions";
import type { RunManifest } from "@/lib/staging/manifest";

type RunResponse = { manifest: RunManifest; groups: DayGroup[]; questions: Record<string, Question[]> };

function keyFor(group: DayGroup): string {
  return group.undated ? "undated" : group.date;
}

/**
 * Commit every day of this run whose questions are all answered — B1751.
 *
 * Used to be one of two paths `ExtractFlow` offered once a run's board was
 * left — the other, paid one (`CreditsScreen`, "spend to caption extra
 * photos before building") was removed with the credit system in B2592;
 * every photograph description an owner wants now goes through the studio's
 * own `helper` capability, metered by their plan rather than a balance here.
 *
 * The undated group is skipped — it has no real date to commit into until
 * the person sets each photograph's own date individually, which this
 * function has no way to do on their behalf.
 */
export async function commitReadyDays(username: string, runId: string): Promise<void> {
  const res = await fetch(`/api/helper/${encodeURIComponent(username)}/studio/run?run=${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error(String(res.status));
  const { groups, questions } = (await res.json()) as RunResponse;
  for (const group of groups) {
    if (group.undated) continue;
    const open = questions[keyFor(group)] ?? [];
    if (open.length > 0) continue;
    const commit = await fetch(`/api/helper/${encodeURIComponent(username)}/studio/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ run: runId, date: group.date }),
    });
    if (!commit.ok) throw new Error(String(commit.status));
  }
}
