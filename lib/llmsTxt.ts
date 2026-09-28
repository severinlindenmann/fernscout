import "server-only";
import { SKILL_DOC_SLUGS, SKILL_DOC_SUMMARY, SKILL_DOC_TITLE, skillDocPath } from "./api/skillDocMeta";
import { DOCS_PAGES } from "./docs";
import { publicJournals } from "./home";
import { translateIn } from "./locales";
import { serverSite } from "./site";
import { getDefaultUsername } from "./users";
import { PAID_AREAS } from "@paid/manifest";

import { journalPath } from "./journalPath";
/**
 * /llms.txt, in the llmstxt.org shape — B2487.
 *
 * Built from the lists the rest of the site already renders from — the skill
 * guides' own titles and summaries, `DOCS_PAGES`, `publicJournals()` — so a
 * guide added or retired there is added or retired here, and
 * `test/llms-txt.test.ts` fails if a link in it stops resolving. Public
 * content only: the example journal is one the landing page already
 * advertises.
 *
 * `/documentation.txt` stays the full guide (and keeps its own name and its
 * `noindex`, see app/documentation.txt/route.ts); this is the index that
 * points an agent at it.
 */
export function llmsTxt(): string {
  const site = serverSite();
  const base = site.url;
  const link = (title: string, path: string, note?: string) =>
    `- [${title}](${base}${path})${note ? `: ${note}` : ""}`;

  const journals = publicJournals();
  const preferred = getDefaultUsername();
  const example = journals.find((j) => j.username === preferred) ?? journals[0];

  const lines = [
    `# ${site.name}`,
    "",
    `> ${translateIn("en", "landing.metaDescription")} A self-hostable travel journal with an HTTP API an agent can write through, with the owner's review.`,
    "",
    "## Docs",
    "",
    link("Documentation for agents", "/documentation.txt", "what this instance is, how to get a token, and every door"),
    link("OpenAPI v2", "/api/v2/openapi.json", "the API contract, generated from the schemas the server checks against"),
    "",
    "## Task guides",
    "",
    ...SKILL_DOC_SLUGS.map((slug) => link(SKILL_DOC_TITLE[slug], skillDocPath(slug), SKILL_DOC_SUMMARY[slug])),
  ];

  if (PAID_AREAS.includes("orgs")) {
    lines.push(
      "",
      "## For schools and tour operators",
      "",
      link("Schools", "/schools"),
      link("Tour operators", "/tour-operators"),
    );
  }

  if (example) {
    lines.push("", "## Example", "", link(example.title, journalPath(example.username), "a public journal on this instance"));
  }

  lines.push(
    "",
    "## Optional",
    "",
    ...DOCS_PAGES.map((page) => link(translateIn("en", page.labelKey), page.href, translateIn("en", page.blurbKey))),
    "",
  );
  return lines.join("\n");
}
