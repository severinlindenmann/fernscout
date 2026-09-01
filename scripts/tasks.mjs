#!/usr/bin/env node
// Move task files between lanes, and regenerate docs/tasks/INDEX.md from what
// is actually on disk.
//
// The lane a file sits in is the task's status — there is no `status:` field,
// because a status kept in two places disagrees with itself within a month.
// This script exists so the index is read off the folders rather than typed,
// for the same reason.
//
// `backlog` is where anything new lands. `open` is the reviewed queue an agent
// may take work from unprompted, and moving a task into it is a person's
// decision — see the skill. The script will not do it for you by accident:
// `new` always writes to backlog/.
//
//   npm run tasks                          what is in each lane
//   npm run tasks -- new --type ISSUE --priority high \
//       --complexity low --title "…" [--area "…"]
//   npm run tasks -- move B01 in-development
//   npm run tasks -- index                 rewrite INDEX.md only
//
// Frontmatter is edited line by line rather than round-tripped through a YAML
// parser: a round trip reformats dates and drops the alignment, and a diff
// full of churn is a diff nobody reads.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "docs", "tasks");
// Flow order, which is also the order they are written into INDEX.md.
const LANES = ["backlog", "open", "in-development", "completed"];
/** Where `new` puts things. Never `open` — that lane is a person's review. */
const INTAKE = "backlog";
const TYPES = ["SECURITY", "ISSUE", "FEATURE", "CHORE"];
const PRIORITIES = ["high", "medium", "low"];
const COMPLEXITIES = ["low", "medium", "high"];

const BEGIN = "<!-- generated:begin -->";
const END = "<!-- generated:end -->";

const today = () => new Date().toISOString().slice(0, 10);

function die(message) {
  console.error(message);
  process.exit(1);
}

/** The frontmatter block and the body, kept as text. */
function split(file) {
  const raw = fs.readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  if (!match) die(`${path.relative(process.cwd(), file)} has no frontmatter block.`);
  return { front: match[1], body: match[2] };
}

function field(front, key) {
  const match = new RegExp(`^${key}:\\s*(.*)$`, "m").exec(front);
  if (!match) return undefined;
  return match[1].trim().replace(/^["'](.*)["']$/, "$1");
}

/** Set a key, or add it at the end of the block if it is not there yet. */
function setField(front, key, value) {
  const line = `${key}: ${/[:#]/.test(value) ? JSON.stringify(value) : value}`;
  const existing = new RegExp(`^${key}:\\s*.*$`, "m");
  return existing.test(front) ? front.replace(existing, line) : `${front}\n${line}`;
}

function itemsIn(lane) {
  const dir = path.join(ROOT, lane);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((filename) => {
      const file = path.join(dir, filename);
      const { front } = split(file);
      return {
        lane,
        file,
        filename,
        id: field(front, "id") ?? filename.slice(0, 3),
        title: field(front, "title") ?? filename,
        type: field(front, "type") ?? "ISSUE",
        priority: field(front, "priority") ?? "medium",
        complexity: field(front, "complexity") ?? "medium",
      };
    })
    .sort(
      (a, b) =>
        PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
        a.id.localeCompare(b.id),
    );
}

function allItems() {
  return LANES.flatMap(itemsIn);
}

function nextId() {
  const numbers = allItems().map((i) => Number.parseInt(i.id.replace(/\D/g, ""), 10) || 0);
  return `B${String(Math.max(0, ...numbers) + 1).padStart(2, "0")}`;
}

function slug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
}

function table(lane) {
  const items = itemsIn(lane);
  if (items.length === 0) return "_Nothing here._\n";
  const rows = items.map(
    (i) =>
      `| [${i.id}](${lane}/${i.filename}) | ${i.title} | ${i.type} | ${i.priority} | ${i.complexity} |`,
  );
  return [
    "| # | Finding | Type | Priority | Complexity |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function writeIndex() {
  const file = path.join(ROOT, "INDEX.md");
  const raw = fs.readFileSync(file, "utf8");
  const start = raw.indexOf(BEGIN);
  const end = raw.indexOf(END);
  if (start === -1 || end === -1) {
    die(`docs/tasks/INDEX.md is missing its ${BEGIN} / ${END} markers.`);
  }
  const generated = [
    BEGIN,
    "",
    ...LANES.flatMap((lane) => [`## ${lane}`, "", table(lane)]),
  ].join("\n");
  fs.writeFileSync(file, raw.slice(0, start) + generated + raw.slice(end));
  console.log(`docs/tasks/INDEX.md — ${allItems().length} tasks across ${LANES.length} lanes.`);
}

function flag(argv, name) {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
}

function create(argv) {
  const title = flag(argv, "title");
  const type = (flag(argv, "type") ?? "").toUpperCase();
  const priority = flag(argv, "priority") ?? "medium";
  const complexity = flag(argv, "complexity") ?? "medium";
  const area = flag(argv, "area") ?? "";

  if (!title) die("--title is required.");
  if (!TYPES.includes(type)) die(`--type must be one of ${TYPES.join(", ")}.`);
  if (!PRIORITIES.includes(priority)) die(`--priority must be one of ${PRIORITIES.join(", ")}.`);
  if (!COMPLEXITIES.includes(complexity)) {
    die(`--complexity must be one of ${COMPLEXITIES.join(", ")}.`);
  }

  const id = nextId();
  const file = path.join(ROOT, INTAKE, `${id}-${slug(title)}.md`);
  const front = [
    `id: ${id}`,
    `title: ${title}`,
    `type: ${type}`,
    `priority: ${priority}`,
    `complexity: ${complexity}`,
    ...(area ? [`area: ${area}`] : []),
    `found: "${today()}"`,
  ].join("\n");

  fs.writeFileSync(
    file,
    `---\n${front}\n---\n\n# ${id} — ${title}\n\n## Why\n\nTODO — the problem, not the fix.\n\n## Work\n\nTODO\n\n## Acceptance\n\nTODO\n`,
  );
  console.log(`Created ${path.relative(process.cwd(), file)}`);
  writeIndex();
}

function move(argv) {
  const [id, lane] = argv;
  if (!id || !LANES.includes(lane)) {
    die(`Usage: move <id> <${LANES.join("|")}>`);
  }
  const item = allItems().find((i) => i.id.toLowerCase() === id.toLowerCase());
  if (!item) die(`No item with id ${id}.`);
  if (item.lane === lane) die(`${item.id} is already in ${lane}.`);

  const { front, body } = split(item.file);
  let updated = front;
  if (lane === "in-development") updated = setField(updated, "started", `"${today()}"`);
  if (lane === "completed") updated = setField(updated, "completed", `"${today()}"`);

  const target = path.join(ROOT, lane, item.filename);
  fs.writeFileSync(item.file, `---\n${updated}\n---\n${body}`);
  fs.renameSync(item.file, target);
  console.log(`${item.id}: ${item.lane} → ${lane}`);
  writeIndex();
}

function list() {
  for (const lane of LANES) {
    const items = itemsIn(lane);
    console.log(`\n${lane} (${items.length})`);
    for (const i of items) {
      console.log(`  ${i.id}  ${i.type.padEnd(8)} ${i.priority.padEnd(6)} ${i.title}`);
    }
  }
  console.log("");
}

const [command, ...rest] = process.argv.slice(2);
if (!fs.existsSync(ROOT)) die("Run this from the repository root — docs/tasks is not here.");

switch (command) {
  case undefined:
  case "list":
    list();
    break;
  case "new":
    create(rest);
    break;
  case "move":
    move(rest);
    break;
  case "index":
    writeIndex();
    break;
  default:
    die(`Unknown command "${command}". Try: list, new, move, index.`);
}
