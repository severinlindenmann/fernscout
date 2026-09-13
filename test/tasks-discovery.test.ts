import { afterEach, describe, expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
const script = path.join(process.cwd(), "scripts", "tasks.mjs");
const lanes = ["backlog", "open", "in-development", "testing", "completed"];
const temps: string[] = [];

function checkout(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-task-discovery-")));
  temps.push(dir);
  for (const lane of lanes) fs.mkdirSync(path.join(dir, "docs", "tasks", lane), { recursive: true });
  for (const category of ["issue", "chore"]) {
    fs.mkdirSync(path.join(dir, "docs", "tasks", "backlog", category), { recursive: true });
  }
  fs.writeFileSync(
    path.join(dir, "docs", "tasks", "INDEX.md"),
    "# Tasks\n\n<!-- generated:begin -->\n<!-- generated:end -->\n",
  );
  return dir;
}

function addTask(
  dir: string,
  id: string,
  title: string,
  lane: string,
  { type = "ISSUE", body = "Distinct task prose." } = {},
) {
  const category = type === "CHORE" ? "chore" : "issue";
  const folder = lane === "backlog" ? path.join(lane, category) : lane;
  fs.writeFileSync(
    path.join(dir, "docs", "tasks", folder, `${id}-task.md`),
    `---\nid: ${id}\ntitle: ${title}\ntype: ${type}\npriority: medium\ncomplexity: low\n---\n\n# ${id} — ${title}\n\n${body}\n`,
  );
}

async function tasks(dir: string, ...args: string[]) {
  return run("node", [script, ...args], { cwd: dir });
}

afterEach(() => {
  while (temps.length) fs.rmSync(temps.pop()!, { recursive: true, force: true });
});

describe("concise task discovery", () => {
  test("the default names active tasks but only counts backlog and completed", async () => {
    const dir = checkout();
    addTask(dir, "B01", "Backlog detail", "backlog");
    addTask(dir, "B02", "Approved detail", "open");
    addTask(dir, "B03", "Work detail", "in-development");
    addTask(dir, "B04", "Testing detail", "testing");
    addTask(dir, "B05", "Completed detail", "completed");

    const { stdout } = await tasks(dir);

    expect(stdout).toContain("backlog: 1");
    expect(stdout).toContain("completed: 1");
    expect(stdout).toContain("Approved detail");
    expect(stdout).toContain("Work detail");
    expect(stdout).toContain("Testing detail");
    expect(stdout).not.toContain("Backlog detail");
    expect(stdout).not.toContain("Completed detail");
    expect(Buffer.byteLength(stdout)).toBeLessThan(10_240);
  });

  test("lists one lane and optionally one derived category", async () => {
    const dir = checkout();
    addTask(dir, "B01", "Issue detail", "backlog");
    addTask(dir, "B02", "Chore detail", "backlog", { type: "CHORE" });
    addTask(dir, "B03", "Open detail", "open");

    const lane = await tasks(dir, "list", "--lane", "open");
    expect(lane.stdout).toContain("Open detail");
    expect(lane.stdout).not.toContain("Issue detail");

    const category = await tasks(dir, "list", "--lane", "backlog", "--category", "chore");
    expect(category.stdout).toContain("Chore detail");
    expect(category.stdout).not.toContain("Issue detail");
  });

  test("keeps the former exhaustive listing behind --all", async () => {
    const dir = checkout();
    addTask(dir, "B01", "Backlog detail", "backlog");
    addTask(dir, "B02", "Completed detail", "completed");

    const { stdout } = await tasks(dir, "list", "--all");

    expect(stdout).toContain("Backlog detail");
    expect(stdout).toContain("Completed detail");
  });

  test("shows one complete task by id", async () => {
    const dir = checkout();
    addTask(dir, "B01", "One task", "backlog", { body: "Acceptance detail unique to this task." });

    const { stdout } = await tasks(dir, "show", "b01");

    expect(stdout).toContain("backlog/issue/B01-task.md");
    expect(stdout).toContain("Acceptance detail unique to this task.");
    expect(stdout).not.toContain("matches (");
  });

  test("searches all words and caps broad results unless --all is explicit", async () => {
    const dir = checkout();
    for (let number = 1; number <= 30; number += 1) {
      addTask(dir, `B${String(number).padStart(2, "0")}`, `Shared needle ${number}`, "completed");
    }
    addTask(dir, "B31", "Needle without the other word", "completed", { body: "Nothing else." });

    const concise = await tasks(dir, "search", "shared", "needle");
    expect(concise.stdout).toContain("matches (30)");
    expect(concise.stdout).toContain("… 5 more");
    expect(concise.stdout).not.toContain("B30");

    const exhaustive = await tasks(dir, "search", "shared", "needle", "--all");
    expect(exhaustive.stdout).toContain("B30");
    expect(exhaustive.stdout).not.toContain("… 5 more");
  });

  test("refuses an unknown lane with the supported choices", async () => {
    const dir = checkout();

    await expect(tasks(dir, "list", "--lane", "nowhere")).rejects.toThrow(
      /--lane must be one of backlog, open, in-development, testing, completed/,
    );
  });
});
