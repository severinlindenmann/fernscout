import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectRouteTypesStamp,
  writeRouteTypesStamp,
} from "../scripts/route-types-stamp.mjs";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-route-types-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "app", "trips", "[trip]"), { recursive: true });
  fs.mkdirSync(path.join(root, "components"), { recursive: true });
  fs.mkdirSync(path.join(root, ".next", "types"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "next"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "trips", "[trip]", "page.tsx"), "export default 1\n");
  fs.writeFileSync(path.join(root, "components", "Card.tsx"), "export default 1\n");
  fs.writeFileSync(path.join(root, ".next", "types", "routes.d.ts"), "type Route = '/trips/[trip]'\n");
  fs.writeFileSync(path.join(root, "next.config.ts"), "export default { typedRoutes: true }\n");
  fs.writeFileSync(path.join(root, "node_modules", "next", "package.json"), '{"version":"16.3.3"}\n');
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("route type build stamp", () => {
  it("writes the stamp only after the build command succeeds", () => {
    const root = fixture();
    fs.rmSync(path.join(root, ".next"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "next", "dist", "bin"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "next", "dist", "bin", "next"),
      "import fs from 'node:fs'; fs.mkdirSync('.next/types', { recursive: true }); fs.writeFileSync('.next/types/routes.d.ts', 'generated\\n');\n",
    );
    const buildScript = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/build.mjs");

    const result = spawnSync(process.execPath, [buildScript], { cwd: root, encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Stamped .next/types");
    expect(inspectRouteTypesStamp(root).valid).toBe(true);
  });

  it("accepts unchanged route inputs and generated types", () => {
    const root = fixture();
    writeRouteTypesStamp(root);

    expect(inspectRouteTypesStamp(root)).toEqual({
      valid: true,
      reason: "route inputs and generated types match the last successful build",
    });
  });

  it("does not invalidate types for an ordinary component edit", () => {
    const root = fixture();
    writeRouteTypesStamp(root);
    fs.writeFileSync(path.join(root, "components", "Card.tsx"), "export default 2\n");

    expect(inspectRouteTypesStamp(root).valid).toBe(true);
  });

  it("invalidates types when a route is added", () => {
    const root = fixture();
    writeRouteTypesStamp(root);
    fs.mkdirSync(path.join(root, "app", "about"));
    fs.writeFileSync(path.join(root, "app", "about", "page.tsx"), "export default 1\n");

    expect(inspectRouteTypesStamp(root)).toEqual({
      valid: false,
      reason: "the route graph, Next version, or Next config changed",
    });
  });

  it("invalidates types when generated output changes", () => {
    const root = fixture();
    writeRouteTypesStamp(root);
    fs.writeFileSync(path.join(root, ".next", "types", "routes.d.ts"), "broken\n");

    expect(inspectRouteTypesStamp(root)).toEqual({
      valid: false,
      reason: "the generated route types changed after the build",
    });
  });

  it.each([
    ["Next config", (root: string) => fs.appendFileSync(path.join(root, "next.config.ts"), "// changed\n")],
    [
      "Next version",
      (root: string) =>
        fs.writeFileSync(path.join(root, "node_modules", "next", "package.json"), '{"version":"16.4.0"}\n'),
    ],
  ])("invalidates types when %s changes", (_label, change) => {
    const root = fixture();
    writeRouteTypesStamp(root);
    change(root);

    expect(inspectRouteTypesStamp(root).valid).toBe(false);
  });
});
