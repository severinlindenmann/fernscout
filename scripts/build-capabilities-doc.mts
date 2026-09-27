// Regenerates the feature table in docs/capabilities.md from the code that
// actually decides scope and edition, so the doc cannot drift the way it once
// did: the table said "off by default" and listed `signup` as a per-journal
// switch, when `signup` has no switch at all and almost everything else is
// operator-only.
//
//   npx tsx --conditions=react-server scripts/build-capabilities-doc.mts
//
// `test/capabilities-doc.test.ts` regenerates the same table and fails the
// suite if the committed file has drifted from it.
import fs from "node:fs";
import path from "node:path";
import { FEATURE_NAMES, OPERATOR_ONLY_FEATURES, type FeatureName } from "../lib/config";
import { PAID_FEATURES } from "../lib/capabilities";

const ROOT = path.join(import.meta.dirname, "..");

export const START = "<!-- BEGIN:generated-feature-table (scripts/build-capabilities-doc.mts) -->";
export const END = "<!-- END:generated-feature-table -->";

export function buildFeatureTable(): string {
  const operatorOnly: readonly string[] = OPERATOR_ONLY_FEATURES;
  const rows = [...FEATURE_NAMES]
    .sort()
    .map((name: FeatureName) => {
      const scope = operatorOnly.includes(name) ? "server-wide" : "per journal";
      const hosted = PAID_FEATURES.includes(name) ? "hosted edition only" : "—";
      return `| \`${name}\` | ${scope} | ${hosted} |`;
    });
  return [
    START,
    "",
    "Generated from `FEATURE_NAMES`, `OPERATOR_ONLY_FEATURES` and `PAID_FEATURES`",
    "in [`lib/config.ts`](../lib/config.ts) and [`lib/capabilities.ts`](../lib/capabilities.ts)",
    "by `npm run docs:capabilities` (`scripts/build-capabilities-doc.mts`) — run it",
    "after adding or reclassifying a feature, rather than editing this table by",
    "hand. `test/capabilities-doc.test.ts` fails if this table has drifted from",
    "what it would generate.",
    "",
    "| Feature | Scope | Edition |",
    "| --- | --- | --- |",
    ...rows,
    "",
    END,
  ].join("\n");
}

export function applyToDoc(source: string): string {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < 0) {
    throw new Error(`docs/capabilities.md is missing the ${START} / ${END} markers`);
  }
  return source.slice(0, start) + buildFeatureTable() + source.slice(end + END.length);
}

function main() {
  const file = path.join(ROOT, "docs", "capabilities.md");
  const source = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, applyToDoc(source));
  console.log("docs/capabilities.md: feature table regenerated");
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main();
}
