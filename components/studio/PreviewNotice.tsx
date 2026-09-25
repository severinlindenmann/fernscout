/**
 * Step 03's own sentence, said plainly — B1824, spec §4.
 *
 * "Preview — real numbers and real content, with an explicit line saying
 * nothing has been written yet." Every flow's preview step carries this
 * exact line rather than composing its own wording each time, because a
 * paraphrase drifts (`PreviewScreen.tsx`'s own doc comment already makes
 * this promise for the photographs import; `t("studio.skeleton.notWritten")`
 * is the one sentence every other flow inherits).
 */
export default function PreviewNotice({ text }: { text: string }) {
  return <p className="text-sm text-ink-secondary">{text}</p>;
}
