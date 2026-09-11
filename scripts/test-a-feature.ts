#!/usr/bin/env -S npx tsx --conditions=react-server
import { FEATURE_NAMES, type FeatureName } from "@/lib/config";
import { COVERAGE } from "@/docs/testing/coverage";

/**
 * The entry point docs/testing/coverage.ts exists to serve: given a
 * capability, say which flows exercise it (and, when there are none yet,
 * say why) — so "test this feature on desktop and mobile" is a lookup
 * rather than a person hand-assembling personas each time.
 *
 * Deliberately does not drive a browser or an agent conversation itself —
 * that orchestration differs per interface (WhatsApp: scripts/simulate-webhook.ts;
 * /agent and the journal UI: an interactive session following the flow file's
 * own steps, same as .claude/skills/test-in-a-browser already does). This
 * script's job stops at "here is what to run and why," which is printed for
 * a session to carry out; automating the drive-it-yourself half is future
 * work once more than three flows exist to learn a pattern from.
 */

export function resolveFlows(capability: FeatureName): { flows: string[]; note?: string } {
  if (!(FEATURE_NAMES as readonly string[]).includes(capability)) {
    throw new Error(`unknown capability "${capability}" (see lib/config.ts FEATURE_NAMES)`);
  }
  const entry = COVERAGE[capability];
  if ("todo" in entry) return { flows: [], note: entry.todo };
  return { flows: [...entry.flows] };
}

function parseList(value: string | undefined): string[] | undefined {
  return value ? value.split(",").map((v) => v.trim()).filter(Boolean) : undefined;
}

function main() {
  const [capability, ...rest] = process.argv.slice(2);
  if (!capability) {
    console.error("usage: test-a-feature.ts <capability> [--device desktop,mobile] [--locale en,de,hu]");
    process.exitCode = 1;
    return;
  }
  const deviceIndex = rest.indexOf("--device");
  const localeIndex = rest.indexOf("--locale");
  const devices = parseList(deviceIndex >= 0 ? rest[deviceIndex + 1] : undefined) ?? ["desktop"];
  const locales = parseList(localeIndex >= 0 ? rest[localeIndex + 1] : undefined) ?? ["en"];

  const { flows, note } = resolveFlows(capability as FeatureName);
  if (flows.length === 0) {
    console.log(`No flows cover "${capability}" yet.${note ? ` (${note})` : ""}`);
    return;
  }
  console.log(`Flows covering "${capability}":`);
  for (const flow of flows) {
    console.log(`  - docs/testing/flows/${flow}.md, across devices [${devices.join(", ")}] and locales [${locales.join(", ")}]`);
  }
  console.log("\nOpen each flow file and follow its Setup/Steps/Done-when sections.");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
