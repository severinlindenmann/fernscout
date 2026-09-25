import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// B2144: machine-wide slots so concurrent sessions queue instead of taking the
// machine down. Each case runs the real CLI against its own slot folder.

const script = path.join(process.cwd(), "scripts", "slot.mjs");
let dir: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "slots-"));
  // Under `npm run verify` this process already holds a heavy slot, and a
  // child that inherited the marker would skip the queue it is here to test.
  env = { ...process.env, FERNSCOUT_SLOT_DIR: dir, FERNSCOUT_MIN_FREE_GB: "0" };
  delete env.FERNSCOUT_SLOT_HELD;
  delete env.FERNSCOUT_SLOTS;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(kind: string, seconds: number) {
  const child = spawn(process.execPath, [script, kind, "--", "sleep", String(seconds)], { env });
  let stderr = "";
  child.stderr.on("data", (c) => (stderr += c));
  const done = new Promise<{ code: number | null; at: number }>((resolve) =>
    child.on("close", (code) => resolve({ code, at: Date.now() })),
  );
  return { child, done, stderr: () => stderr };
}

const status = () => spawnSync(process.execPath, [script, "status"], { env, encoding: "utf8" }).stdout;
const until = async (check: () => boolean) => {
  while (!check()) await new Promise((r) => setTimeout(r, 50));
};

describe("machine slots", () => {
  it("runs two heavy jobs at once and queues the third until one finishes", async () => {
    const started = Date.now();
    const a = run("heavy", 1);
    const b = run("heavy", 1);
    await until(() => status().includes("heavy: 2/2"));
    const c = run("heavy", 0.1);

    await until(() => c.stderr().includes("Waiting for a slot"));
    expect(c.stderr()).toContain("all 2 heavy slots are taken");
    expect(c.stderr()).toContain("sleep 1");

    const [ra, rb, rc] = await Promise.all([a.done, b.done, c.done]);
    expect([ra.code, rb.code, rc.code]).toEqual([0, 0, 0]);
    expect(rc.at).toBeGreaterThanOrEqual(Math.min(ra.at, rb.at));
    expect(c.stderr()).toContain("heavy slot free");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(status()).toContain("heavy: 0/2");
  }, 20_000);

  it("frees a dead holder's slot and never a live one", () => {
    const dead = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" });
    const record = (pid: number) => JSON.stringify({ pid, label: "x", cwd: "/", since: new Date().toISOString() });
    fs.writeFileSync(path.join(dir, "heavy-1"), record(Number(dead.stdout)));
    fs.writeFileSync(path.join(dir, "heavy-2"), record(process.pid));

    expect(status()).toContain("heavy: 1/2");
    expect(fs.existsSync(path.join(dir, "heavy-1"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "heavy-2"))).toBe(true);
  });

  it("refuses a dev server past the limit and names the holders", async () => {
    env.FERNSCOUT_DEV_SLOTS = "1";
    const holder = run("dev", 5);
    await until(() => status().includes("dev: 1/1"));

    const refused = spawnSync(process.execPath, [script, "dev", "--", "sleep", "0"], { env, encoding: "utf8" });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("all 1 dev slots are taken");
    expect(refused.stderr).toContain(`sleep 5`);
    expect(refused.stderr).toContain("never another session's");

    holder.child.kill("SIGTERM");
    await holder.done;
    expect(status()).toContain("dev: 0/1");
  }, 20_000);
});
