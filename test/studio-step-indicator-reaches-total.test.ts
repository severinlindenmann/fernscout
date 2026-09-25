import fs from "node:fs";
import path from "node:path";
import { paidCounterparts } from "./support/openCore";
import { describe, expect, test } from "vitest";

/**
 * B1943 — `AddDayFlow`'s own commit screen, the last thing a person presses
 * before a write, was labelled "4 of 5" against a flow that never reaches
 * 5. The spec's skeleton (§4) is five steps ending in "do it"; a screen
 * that merges "decide" and "do it" into one (as this one, and
 * `InviteReaderFlow`'s "preview", both do) is still the *last* step, so its
 * own indicator must read as the last one.
 *
 * This is a static source scan, not a render test: every flow on the fixed
 * ("wizard") shape of `StepIndicator` — a literal `total`, not one read off
 * a run (see `StepIndicator`'s own doc comment for that distinction) —
 * must have some screen whose `current` equals its own `total`, and the
 * locale string next to it must say the same number. Catches this class of
 * bug on any flow built on the skeleton, not only the two this ticket
 * found.
 */

const ROOT = path.join(import.meta.dirname, "..");

// Files known to use `StepIndicator`'s fixed-shape form — a literal
// `total`, constant across the flow, the case this component's own doc
// comment distinguishes from a real per-run count (`DayBoard`, `AskCard`,
// `UploadStep`, `TripModeStep`, `FoundStep` all read a real number and are
// deliberately not here).
// Derived, never listed. B1943 wrote this as a literal array naming
// `components/studio/ComingSoonFlow.tsx`, which the postcard flow deleted
// the same day — and a flow added tomorrow would simply have gone
// unchecked. The claim is that EVERY fixed-shape flow reaches its own
// total, so the test has to go and find them.
const FLOW_FILES = fs
  .readdirSync(path.join(ROOT, "components", "studio"), { recursive: true })
  .map((entry) => String(entry).split(path.sep).join("/"))
  .filter((file) => file.endsWith("Flow.tsx"))
  .map((file) => `components/studio/${file}`)
  .concat(
    paidCounterparts("components/studio").flatMap((dir) =>
      fs
        .readdirSync(dir, { recursive: true })
        .map(String)
        .filter((file) => file.endsWith("Flow.tsx"))
        .map((file) => path.relative(ROOT, path.join(dir, file)).split(path.sep).join("/")),
    ),
  )
  .sort();

type Invocation = { totalExpr: string; current: number; labelKey: string | null };

function parseInvocations(source: string): Invocation[] {
  const out: Invocation[] = [];
  const re = /<StepIndicator\b([\s\S]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const body = m[1];
    const totalMatch = body.match(/total=\{([^}]+)\}/);
    const currentMatch = body.match(/current=\{(\d+)\}/);
    const labelMatch = body.match(/label=\{t\("([^"]+)"/);
    if (!totalMatch || !currentMatch) continue;
    out.push({ totalExpr: totalMatch[1].trim(), current: Number(currentMatch[1]), labelKey: labelMatch?.[1] ?? null });
  }
  return out;
}

/** How many entries a same-file `const <name> = [ … ]` array literal has. */
function arrayLength(name: string, source: string): number | null {
  const m = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  return m ? m[1].split(",").filter((s) => s.trim()).length : null;
}

/** Resolves a `total={...}` expression to a fixed number when it is one —
 *  a literal (`5`), a same-file `const <name> = <number>;`, a same-file
 *  array's `<NAME>.length`, or — B2077 — the `total` a `useStep(<NAME>, …)`
 *  hands back, which is that steps array's length (optionally `total - n`,
 *  for a flow whose opening screen carries no indicator). */
function resolveTotal(expr: string, source: string): number | null {
  if (/^\d+$/.test(expr)) return Number(expr);
  const length = expr.match(/^(\w+)\.length$/);
  if (length) return arrayLength(length[1], source);
  const derived = expr.match(/^total(?:\s*-\s*(\d+))?$/);
  const steps = source.match(/useStep\(\s*(\w+)\s*,/);
  if (derived && steps) {
    const n = arrayLength(steps[1], source);
    return n === null ? null : n - Number(derived[1] ?? 0);
  }
  const constMatch = source.match(new RegExp(`const\\s+${expr}\\s*=\\s*(\\d+)\\s*;`));
  return constMatch ? Number(constMatch[1]) : null;
}

const en = JSON.parse(fs.readFileSync(path.join(ROOT, "site", "locales", "en.json"), "utf8")) as Record<string, string>;

describe("Every fixed-shape studio flow reaches its own last step — B1943", () => {
  for (const file of FLOW_FILES) {
    test(file, () => {
      const source = fs.readFileSync(path.join(ROOT, file), "utf8");
      const invocations = parseInvocations(source);
      const fixed = invocations
        .map((inv) => ({ ...inv, total: resolveTotal(inv.totalExpr, source) }))
        .filter((inv): inv is Invocation & { total: number } => inv.total !== null);

      // A flow with no fixed-shape indicator is not a failure. Three of them
      // have none — `EditDayFlow` hands the middle of the flow to `EditDay`,
      // and `PostcardFlow` and `TripVisibilityFlow` are short enough that the
      // drawing never gave them a bar. The claim this file holds is "a flow
      // that counts its steps reaches its own total", not "every flow
      // counts". Requiring the latter was safe only while the list of flows
      // was written by hand; deriving it turned that into three false
      // failures within the hour.
      if (fixed.length === 0) return;

      const totals = new Set(fixed.map((inv) => inv.total));
      // Every fixed call in one flow shares the same declared shape.
      expect(totals.size).toBe(1);
      const [total] = [...totals];

      const maxCurrent = Math.max(...fixed.map((inv) => inv.current));
      expect(maxCurrent, `${file}: no screen reaches ${total} of ${total}`).toBe(total);

      // The literal locale string beside the last screen's indicator must
      // say the same number — a bare prop fix that forgets the copy is the
      // exact failure mode B1943 itself was (the numbers were baked into
      // "4 of 5 · check").
      // Only checked when the copy bakes a number in at all — some flows'
      // labels are bare words ("do it", "which of the three") and have no
      // number to disagree with.
      const last = fixed.find((inv) => inv.current === total && inv.labelKey);
      if (last?.labelKey) {
        const text = en[last.labelKey];
        expect(text, `${file}: missing en label "${last.labelKey}"`).toBeDefined();
        if (text && /\d/.test(text)) {
          expect(text, `${file}: "${last.labelKey}" ("${text}") does not read as ${total} of ${total}`).toMatch(
            new RegExp(`(^|\\D)${total}(\\s*(of|/)\\s*${total}\\b|\\/${total}\\b)`),
          );
        }
      }
    });
  }
});
