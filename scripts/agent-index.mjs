export const AGENT_AREAS = [
  {
    name: "API and public contracts",
    matches: (file) => file.startsWith("app/api/") || file.startsWith("lib/api/"),
    tests: ["test/api-route-schemas.test.ts", "test/openapi-contract.test.ts", "test/openapi-v2-contract.test.ts"],
    docs: ["docs/agents/repository-verification.md"],
    skills: ["keep-the-contract"],
    visible: ["Read the generated OpenAPI operation and verify every accepted field reads back."],
  },
  {
    name: "database portability",
    matches: (file) => file.startsWith("lib/db/") || file.includes("db-migration") || file.includes("db-repo"),
    tests: ["test/db-selection.test.ts", "test/db-migrations.test.ts", "test/db-repos.test.ts"],
    docs: ["docs/agents/repository-verification.md"],
    skills: ["test-a-feature"],
    visible: ["Exercise both SQLite and Postgres paths when the data contract changes."],
  },
  {
    name: "guided helper and model honesty",
    matches: (file) => file.startsWith("lib/helper/") || file.startsWith("app/api/helper/") || file.startsWith("components/Helper"),
    tests: ["test/helper-honesty.test.ts", "test/helper-safe-answers.test.ts", "test/helper-tools.test.ts"],
    docs: ["docs/agents/content-model.md"],
    skills: ["test-with-personas", "test-in-a-browser"],
    visible: ["Run an independent guided-helper persona and inspect its claimed action against what the turn did."],
  },
  {
    name: "rendered UI",
    matches: (file) => file.startsWith("app/") || file.startsWith("components/") || file.endsWith(".css"),
    tests: ["test/brand.test.ts", "test/no-browser-dialogs.test.ts"],
    docs: ["docs/agents/repository-verification.md"],
    skills: ["test-in-a-browser"],
    visible: ["Inspect existing content at desktop and phone width, including console and request failures."],
  },
  {
    name: "drawings and order surfaces",
    matches: (file) => file.includes("branding/") || file.startsWith("components/order/") || file.includes("photobook"),
    tests: ["test/order-view.test.ts", "test/photobook-orders.test.ts"],
    docs: ["docs/branding"],
    skills: ["check-a-drawing", "apply-the-brand"],
    visible: ["Use the matching branding workbench and inspect the rendered artifact."],
  },
  {
    name: "provider simulation",
    matches: (file) => /(?:photobook|postcard|whatsapp|mail|rates)/.test(file),
    tests: ["test/photobook-print.test.ts", "test/postcard-orders.test.ts", "test/nightly-rates-and-backup-mail.test.ts"],
    docs: ["docs/agents/network-and-auth.md"],
    skills: ["test-a-feature"],
    visible: ["Use the simulated or dry-run provider; do not require a paid account."],
  },
  {
    name: "agent instructions and skills",
    matches: (file) => file === "AGENTS.md" || file.startsWith("docs/agents/") || file.startsWith(".claude/skills/"),
    tests: ["test/agent-instructions.test.ts", "test/skill-docs.test.ts"],
    docs: ["docs/agents/skills-and-tools.md"],
    skills: ["skill-creator"],
    visible: ["Check instruction size, local links, and shared skill discovery."],
  },
  {
    name: "task workflow and developer tooling",
    matches: (file) => file.startsWith("scripts/") || file.startsWith("docs/tasks/"),
    tests: ["test/tasks-discovery.test.ts", "test/tasks-script.test.ts"],
    docs: ["docs/agents/worktrees-and-tasks.md"],
    skills: ["manage-tasks", "work-on-a-task"],
    visible: ["Run the command from a task worktree and inspect its concise and detailed output."],
  },
];

export function contextForPaths(paths) {
  return AGENT_AREAS.filter((area) => paths.some(area.matches));
}
