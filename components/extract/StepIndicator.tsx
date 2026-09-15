/**
 * The persistent progress strip — B1803 Task 2.1, design-v2.html's `.prog`.
 *
 * "Which of how many", never a percentage: `total` segments, filled solid up
 * to `current - 1` and the current one picked out in yellow. The wizard
 * screens (S2a–S4) pass a fixed `total` of 5 — that is the flow's own shape,
 * not something read off a run, so it is not the kind of count this
 * component refuses to invent. The day board and the per-question screens
 * are different: `total`/`current` there are real counts a caller reads off
 * the run (days told, days in the trip, questions still open for a day) and
 * must never be replaced with a guess.
 *
 * `label` is the exact text to show next to the segments, already resolved
 * by the caller with `t()`/`tn()` — this component renders it, it does not
 * compose it, because the day board's own label counts days told rather than
 * screens (`3 of 9 days told`) and the per-question screens' label counts a
 * day's position in the whole trip rather than the segments drawn
 * (`day 4 of 9` next to 3 question segments) — two different bases for the
 * same-shaped bar, decided by whoever knows which one applies.
 */
export default function StepIndicator({
  total,
  current,
  label,
}: {
  /** Number of segments to draw. Zero renders nothing — there is no "0 of 0". */
  total: number;
  /** 1-indexed position of the segment currently in progress. */
  current: number;
  label: string;
}) {
  if (total <= 0) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-full bg-surface-subtle px-3 py-1.5" aria-label={label}>
      <span className="flex flex-1 gap-[3px]" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < current - 1 ? "bg-green-500" : i === current - 1 ? "bg-yellow-400" : "bg-line-faint"
            }`}
          />
        ))}
      </span>
      <span className="whitespace-nowrap font-mono text-[0.7rem] font-medium text-ink-secondary">{label}</span>
    </div>
  );
}
