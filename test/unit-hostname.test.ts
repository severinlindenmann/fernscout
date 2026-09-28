import { expect, test } from "vitest";
import fs from "node:fs";

/**
 * `next start --hostname 127.0.0.1` made Next treat every proxy rewrite
 * (`/@anna`, `/de/…`, `.md`) as external, because `nextUrl` calls loopback
 * `localhost`; behind Caddy each one became a TLS fetch to a plain-HTTP port
 * and every journal answered 500 (28 Sep). The unit binds `localhost`.
 */
test("the app unit binds loopback by the name Next's proxy uses", () => {
  const unit = fs.readFileSync("deploy/fernscout.service", "utf8");
  const exec = unit.split("\n").find((line) => line.startsWith("ExecStart="));
  expect(exec).toContain("--hostname localhost");
});
