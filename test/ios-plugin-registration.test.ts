import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * B2655 — `AppleIAPPlugin` was defined and used from JS (`components/
 * nativeShell.ts`) but never registered in `capacitorDidLoad`, so no
 * in-app purchase could ever start. This scans every `.swift` file in
 * `ios/App/App` for a `CAPPlugin` subclass and fails when one is not
 * registered in `ViewController.swift`, so the next plugin that is added
 * and never wired in fails here instead of in the Simulator.
 */
test("every CAPPlugin subclass in the iPhone shell is registered", () => {
  const dir = "ios/App/App";
  const viewController = readFileSync(`${dir}/ViewController.swift`, "utf8");
  const pluginClasses = readdirSync(dir)
    .filter((f) => f.endsWith(".swift"))
    .flatMap((f) => {
      const text = readFileSync(`${dir}/${f}`, "utf8");
      return [...text.matchAll(/class\s+(\w+)\s*:\s*CAPPlugin\b/g)].map((m) => m[1]);
    });
  expect(pluginClasses.length).toBeGreaterThan(0);
  for (const name of pluginClasses) {
    expect(viewController).toMatch(new RegExp(`registerPluginInstance\\(${name}\\(`));
  }
});
