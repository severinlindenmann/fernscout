import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * No colour is used decoratively — B751.
 *
 * `AgentBlock` used to paint a 5px `repeating-linear-gradient` airmail
 * border in coral and sky, chosen because it was the loudest thing this
 * product could draw. It stayed loud after the pages around it went quiet:
 * the owner called it "flashing", and it was the one place in the product
 * where a colour meant nothing but itself. `AgentBlock` now matches the
 * calm `AgentHandover` panel instead — `cream-50`, a `navy-200` hairline,
 * `rounded-2xl` — and this is the guard against the pattern coming back,
 * here or anywhere else in `components/`.
 */

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("no striped panels", () => {
  test("nothing under components/ paints a repeating-linear-gradient", () => {
    const offenders: string[] = [];
    for (const file of walk(path.join(ROOT, "components"))) {
      const source = fs.readFileSync(file, "utf8");
      if (source.includes("repeating-linear-gradient")) {
        offenders.push(path.relative(ROOT, file));
      }
    }
    expect(
      offenders,
      "match components/AgentHandover.tsx's calm panel instead — cream-50, a navy-200 hairline, rounded-2xl (B751)",
    ).toEqual([]);
  });
});
