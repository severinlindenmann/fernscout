import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { bytesNeededFor } from "../scripts/maps-lib.mts";

// B2567 — the monthly street-map refresh.

test("the download needs the rest of the file plus a margin free", () => {
  expect(bytesNeededFor(100, 0)).toBe(110);
  // A broken run resumes: what is already on disk is not needed again.
  expect(bytesNeededFor(100, 60)).toBe(50);
  expect(bytesNeededFor(100, 100)).toBe(10);
});

test("the refresh takes both files from one build and replaces neither in place", () => {
  const unit = fs.readFileSync(path.join("deploy", "fernscout-maps-refresh.service"), "utf8");
  expect(unit).toMatch(/export MAPS_SOURCE=.*maps:planet && .*maps:world/);
  expect(unit).toContain("OnFailure=fernscout-alert@%n.service");
  const world = fs.readFileSync(path.join("scripts", "maps-world.mts"), "utf8");
  expect(world).toMatch(/runPmtilesExtract\(\[source, part,/);
  expect(world).toContain("fs.renameSync(part, out)");
  const planet = fs.readFileSync(path.join("scripts", "maps-planet.mts"), "utf8");
  expect(planet).toContain("fs.renameSync(part, out)");
});
