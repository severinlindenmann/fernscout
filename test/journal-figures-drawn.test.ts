import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Figure } from "@/lib/travellers/vocabulary";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

let dir: string;
let resolveJournalFigures: typeof import("@/lib/trips").resolveJournalFigures;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-figures-"));
  process.env.CONTENT_DIR = dir;
  const figures = path.join(dir, "ana", "figures");
  fs.mkdirSync(figures, { recursive: true });
  fs.writeFileSync(path.join(figures, "ana.json"), JSON.stringify({ id: "ana", name: "Ana", shirt: "blue" }));
  fs.writeFileSync(path.join(figures, "bo.json"), JSON.stringify({ id: "bo", name: "Bo", shirt: "slate" }));
  ({ resolveJournalFigures } = await import("@/lib/trips"));
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const inline = [{ shirt: "red" }] as Figure[];

describe("the journal's default party (B-2959)", () => {
  test("a set selection is drawn from the figure library, in order", () => {
    const party = resolveJournalFigures({
      username: "ana",
      figures: { mode: "set", figures: ["ana", "bo"] },
      travellers: [],
    });
    expect(party.map((f) => f.shirt)).toEqual(["blue", "slate"]);
  });

  test("a missing figure file is skipped", () => {
    const party = resolveJournalFigures({
      username: "ana",
      figures: { mode: "set", figures: ["ana", "gone"] },
      travellers: [],
    });
    expect(party.map((f) => f.shirt)).toEqual(["blue"]);
  });

  test("off, unset or nothing resolvable falls back to the v1 inline travellers", () => {
    expect(resolveJournalFigures({ username: "ana", figures: { mode: "off" }, travellers: inline })).toBe(inline);
    expect(resolveJournalFigures({ username: "ana", travellers: inline })).toBe(inline);
    expect(
      resolveJournalFigures({ username: "ana", figures: { mode: "set", figures: ["gone"] }, travellers: inline }),
    ).toBe(inline);
  });
});
