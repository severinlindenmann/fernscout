import "server-only";
import { serverSite } from "../site";
import { getDefaultUsername, getUser, listedUsernames } from "../users";
import { getTrips } from "../trips";
import { isIndexable } from "../access";
import { CODE_TTL_MINUTES } from "../auth";
import { whatsappNumberForDisplay } from "../whatsapp/settings";
import { openApiDocument } from "./openapi";
import { SKILL_DOC_SLUGS, SKILL_DOC_SUMMARY, SKILL_DOC_TITLE } from "./skillDocMeta";
// The sentences this document shares with the skill docs and /openapi.json,
// kept in one place so they cannot come to disagree.
import { PRIVATE_SHUTS_OUT_GUESTS, VISIBILITY_MEANING, VISIBILITY_NOT_A_LOCK, wrap } from "./agentCopy";

/**
 * The document an owner hands to their agent (decision 25).
 *
 * Step 6 of the v2 migration (docs/v2-migration/03-build-order.md) slims
 * this to narrative: what this instance is, who is on it, and where to look
 * next. The field-by-field reference — every write's shape, every enum,
 * every refusal — used to be inlined here by hand and is now generated: the
 * nine task guides at /skill/*.md (lib/api/skillDocs.ts) and the whole
 * machine contract at /api/v2/openapi.json (generated from the frozen Zod
 * schemas in lib/api/v2/schemas/). A worked JSON example copied from prose
 * here could drift from what the schema actually accepts within a month; a
 * pointer to the generated document cannot.
 *
 * The structure still follows llmstxt.org — an H1, a blockquote summary,
 * prose, then H2 "file lists" of links with notes — because that convention
 * also specifies path scoping, which maps exactly onto one document per
 * user. The filename is `documentation.txt` rather than `llms.txt`
 * (decision 25): it is named for the person handing over the link.
 */

function base(): string {
  return serverSite().url;
}

/**
 * Where an owner's content comes from, when the software has no editing
 * interface (decision 24). A separate repository of agent skills that run on
 * the owner's own machine — a photo library, a bank statement — and write
 * this project's content format. Named in both agent-facing documents,
 * because an agent handed a fresh journal and a person with a laptop full of
 * holiday photographs otherwise has to invent the pipeline.
 */
const HELPER_REPO = "https://github.com/severinlindenmann/fernscout-helper";

/**
 * The instruction the site gives an owner to paste into an agent, in German
 * because that is the language it is offered in — an agent matching on it is
 * matching on what was actually pasted.
 *
 * Built from this instance's own URL rather than written out: quoting
 * fernscout.ch on somebody else's server would hand their owner a prompt
 * pointing at a journal that is not theirs.
 */
const ownerPromptDe = (url: string) =>
  "Führe mich durch das Anlegen meines eigenen Reisetagebuchs, nach der " +
  `Übersicht unter ${url}/documentation.txt. Du brauchst dafür eine ` +
  "E-Mail-Adresse, die mir gehört.";

export function instanceDocumentation(): string {
  const site = serverSite();
  const users = listedUsernames();
  const defaultUser = getDefaultUsername();

  const lines: string[] = [
    `# ${site.name}`,
    "",
    "> A travel journal whose content is markdown and photographs in a folder the",
    "> author owns. Reading happens in a browser. Writing happens through an agent",
    "> holding a token — still no CMS, whether that agent is this instance's own",
    `> hosted one at ${site.url}/agent or one you bring yourself.`,
    "",
    "## Three ways in",
    "",
    ...wrap(
      "Whoever you are — a person with no agent, an agent reading this file, or " +
        "the model behind a browser tab — start by working out which of these " +
        "three you are. It decides what you fetch next.",
      78,
    ),
    "",
    ...wrap(
      `**The guided helper at ${site.url}/agent.** For a person with no agent ` +
        "of their own. No API key, no HTTP client, no header of your own " +
        "choosing — a browser tab, or a voice note. It writes through the same " +
        "calls this document describes: every day it makes still arrives as a " +
        "draft, and publishing is still a second, separate step. It cannot skip " +
        "the owner's own confirmation for anything this document says an agent " +
        "cannot finish — deleting, a real postcard — and it cannot render a " +
        "page; it is a caller of this API, not a way around it.",
      78,
    ),
    "",
    ...wrap(
      "**Your own agent, against this document and `/api/v2/openapi.json`.** " +
        "For an agent that can send an arbitrary HTTP request with a header of " +
        "its own choosing — see \"Can you write here?\" below if you are not " +
        "sure that is you. Running that agent on your own machine, against a " +
        "photo library or a bank statement already on disk, is one way of " +
        `doing this rather than a fourth: ${HELPER_REPO}.`,
      78,
    ),
    "",
    ...wrap(
      (whatsappNumberForDisplay()
        ? `**A messenger, at ${whatsappNumberForDisplay()}.** `
        : "**A messenger**, where this instance offers one. ") +
        "Text it and a model turn answers, on this instance's own model, and " +
        "spends the journal's credits the same way a WhatsApp announcement " +
        "does — one per message, never the owner's own (see below). It can " +
        "start a journal from nothing or add to one that already exists, " +
        "and it writes through the same drafts-then-publish calls as the other " +
        "two. What it cannot do is anything this document already says no " +
        "agent can finish alone, or reach a page only a browser session opens " +
        "— an owner's own settings still need the owner's own browser.",
      78,
    ),
    "",
    "## Already holding a token?",
    "",
    ...wrap(
      `Call \`GET /api/v2/<user>/status\` first, before anything else on this ` +
        "page. It answers in one call where the journal stands: every trip you " +
        "may write to, every **draft waiting for a person to see it**, whether " +
        "your token is journal-wide or scoped to one trip, and storage and " +
        "inbox counts. It is also the cheapest credential check there is: " +
        "`401` means go and get a code, `200` means you are in. " +
        "`GET /api/v2/status` (no `<user>`, no auth) answers for the instance " +
        "itself: which capabilities are on, upload limits, and pricing.",
      78,
    ),
    "",
    ...wrap(
      "**No call returns the owner's email address**, and none will: it is a " +
        "contact detail rather than a setting. If your token has expired, ask the " +
        "person which address owns the journal rather than looking for an endpoint " +
        "that tells you.",
      78,
    ),
    "",
    "## Can you write here?",
    "",
    ...wrap(
      "Check this before you ask anyone for their email address. Writing to this " +
        "journal — creating one, a trip, a day, publishing it — is HTTP `POST`, " +
        "`PUT` or `PATCH`, sent with an `Authorization: Bearer` header carrying a " +
        "token. If your tools only fetch pages, or fetch only a URL a person " +
        "pasted into this conversation and never one found inside a fetched " +
        "page, you cannot make those calls — no matter how completely the rest " +
        "of this document is written.",
      78,
    ),
    "",
    ...wrap(
      "One thing actually does it: a harness or client that can send an " +
        "arbitrary HTTP request with a header of its own choosing.",
      78,
    ),
    "",
    ...wrap(
      "If neither is open to you: say so, plainly, and point them at " +
        `${site.url}/agent instead — a browser door this instance hosts for ` +
        "exactly this case, no API key required. There is still no upload " +
        "interface for *you* to build, no web form, and no CMS behind your own " +
        "calls — that absence is the software (ROADMAP decision 24), not a gap " +
        'for you to route around. Do not offer a file the owner can "manually ' +
        'upload" — nothing here accepts one — and do not hand the job back by ' +
        "telling the owner to follow this guide themselves; send them to " +
        "/agent instead.",
      78,
    ),
    "",
    "## The one rule",
    "",
    ...wrap(
      "You are the editor: you write, you publish, you correct. Everything you " +
        "write arrives as a **draft** — `status` accepts only `\"draft\"` on the " +
        "write itself, and there is no argument that changes that. Putting a day " +
        "on the site is a second call, " +
        `POST /api/v2/<user>/trips/<trip>/days/<slug>/publish, and it is the ` +
        "owner's to make once they say so — never a side effect of writing or " +
        "correcting a day. Ask, in words, and wait for an answer. \"It looks " +
        "finished\" is not consent, and neither is silence.",
      78,
    ),
    "",
    ...wrap(
      "Write what you were told. No weather nobody mentioned, no meals nobody " +
        "ate, no feelings nobody expressed — an empty field beats a plausible " +
        "fiction. The one exception is content nobody lived, written to prove " +
        "the pipeline works: set `test: true` on the trip or the day and the " +
        "site says so itself, in a banner, and keeps it out of the feed and the " +
        "search index.",
      78,
    ),
    "",
    "That third question below is about listing, not access. " + VISIBILITY_NOT_A_LOCK.replace(/`/g, ""),
    "",
    PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, ""),
    "",
    "## Before you call anything, ask",
    "",
    "1. Their **email address** — the only credential that can ever get a token for this journal.",
    "2. The **journal's address** (`username`), if they have none yet — permanent, never invented or illustrated.",
    "3. What the **journal is called** (`title`).",
    "4. **Public or guest?** — " + VISIBILITY_MEANING,
    "5. Their **name**, and **what the site should call them** — two separate questions, never derived from each other.",
    "6. **Which language** they write in, and **which languages a reader may switch into**.",
    "7. **What they count money in** — permanent, never changeable afterwards.",
    "",
    ...wrap(
      "The full script, with a worked example, is at " +
        `${site.url}/skill/new-account.md. Ask all of it, once, before your first call.`,
      78,
    ),
    "",
    "## Where to look next",
    "",
    `- [Getting a code, and creating a journal](${site.url}/skill/new-account.md)`,
    ...SKILL_DOC_SLUGS.filter((s) => s !== "new-account").map(
      (slug) => `- [${SKILL_DOC_TITLE[slug]}](${base()}/skill/${slug}.md): ${SKILL_DOC_SUMMARY[slug]}`,
    ),
    `- [The whole machine contract](${base()}/api/v2/openapi.json): every route, field, enum and refusal, generated from the schemas that check them`,
    `- [What this instance can do](${base()}/api/v2/status): capabilities, limits and pricing — no auth`,
    "",
    "## Letting other people in",
    "",
    ...wrap(
      "A journal has no public sign-up form. Only the journal's owner may issue " +
        "an invite link, never a token scoped to one trip — a guest link leads " +
        "to reading the journal, a buddy link leads to writing to one trip, and " +
        `neither grants anything by itself. See ${site.url}/skill/invite-someone.md.`,
      78,
    ),
    "",
    "## Journals",
    "",
  ];

  if (users.length === 0) {
    lines.push("- (none yet)");
  }
  for (const username of users) {
    const user = getUser(username);
    if (!user) continue;
    const trips = getTrips(username).filter(isIndexable).length;
    const note = [user.tagline, `${trips} public trip${trips === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" — ");
    const marker = username === defaultUser ? " (served at the bare domain too)" : "";
    lines.push(`- [${user.title}](${base()}/${username}/documentation.txt): ${note}${marker}`);
  }

  lines.push(
    "",
    "## If you need help extracting pictures or data",
    "",
    ...wrap(
      "The owner's photographs and receipts are on their own machine, and " +
        "nothing here can reach them. Fernscout Helper is a separate, " +
        "MIT-licensed toolbox of agent skills that runs there: it exports a " +
        "date range out of a photo library, opens a page where the owner picks " +
        "the pictures that belong and says what happened, reads a bank " +
        "statement into per-day costs, and asks about the flights and the car " +
        "that no statement shows. What it writes is this project's own content " +
        "format, as drafts.",
      78,
    ),
    "",
    `- ${HELPER_REPO}`,
    `- [How to use it](${base()}/docs/helper)`,
    "",
    ...wrap(
      "It is optional and nothing here depends on it. If the owner opened " +
        "with the instruction below, they are at the very beginning — no " +
        "journal, no trip, and a laptop full of holiday photographs:",
      78,
    ),
    "",
    `  ${ownerPromptDe(base())}`,
    "",
  );

  return lines.join("\n");
}

/** One journal's document, more specific than the instance one. */
export function userDocumentation(username: string): string | null {
  const user = getUser(username);
  if (!user) return null;

  const root = `${base()}/${username}`;
  const trips = getTrips(username).filter(isIndexable);

  const lines: string[] = [
    `# ${user.title}`,
    "",
    `> ${user.tagline || "A travel journal."} Written by ${user.owner.name}.`,
    "",
    "## Reading this journal",
    "",
    "Every page has a markdown twin: append `.md` to a day's own URL and you get",
    "the day as markdown rather than as a rendering — a reader's view, public,",
    "leaving out the fields a reader does not need. A trip that is not `public`",
    "has no twin at all.",
    "",
    ...(trips.length > 0
      ? [
          "```",
          `${root}/trips/${trips[0].id}/day/<slug>.md`,
          "```",
          "",
        ]
      : []),
    "## Writing to this journal",
    "",
    "```",
    `POST ${base()}/api/auth/codes`,
    `     {"user": "${username}", "email": "<the owner's address>", "for": "write"}`,
    "",
    `POST ${base()}/api/auth/codes/redeem`,
    `     {"user": "${username}", "email": "…", "code": "123456", "for": "write"}`,
    '     -> {"token": "fs_agent_…", "expires": "…", "scope": "write"}',
    "",
    "Then send `Authorization: Bearer <token>` with every call below. Full",
    `steps at ${base()}/skill/new-account.md.`,
    "```",
    "",
    "## Trips",
    "",
  ];

  if (trips.length === 0) {
    lines.push("- (no public trips)");
  }
  for (const trip of trips) {
    const when = `${trip.start} to ${trip.end}`;
    lines.push(`- [${trip.title}](${root}/trips/${trip.id}): ${when}, ${trip.status}`);
  }

  lines.push(
    "",
    "## Endpoints",
    "",
    `- [Status](${base()}/api/v2/${username}/status): where this journal and this token stand`,
    `- [Trips](${base()}/api/v2/${username}/trips): every trip you may write to`,
    `- Days: PUT/GET/PATCH/DELETE ${base()}/api/v2/${username}/trips/<trip-id>/days/<slug> — see ${base()}/skill/add-a-day.md`,
    `- [Media](${base()}/api/v2/${username}/media): one door for photographs, video, documents and imports — see ${base()}/skill/ingest-photos.md`,
    `- [Invites](${base()}/api/v2/${username}/invites): guest and buddy links — owner only, see ${base()}/skill/invite-someone.md`,
    `- [Figures](${base()}/api/v2/${username}/figures/presets): the vocabulary a traveller is drawn in`,
    `- Deleting: DELETE [a trip](${base()}/api/v2/${username}/trips/<trip-id>) or [the journal](${base()}/api/v2/${username}) — owner only, and neither deletes anything: the owner is mailed a link with a button on it`,
    `- [Search index](${root}/search-index.json): every public entry, for finding things`,
    `- [Feed](${root}/feed.xml): public entries as RSS`,
    "",
    PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, ""),
    "",
    "## The guide",
    "",
    ...SKILL_DOC_SLUGS.map(
      (slug) => `- [${SKILL_DOC_TITLE[slug]}](${base()}/skill/${slug}.md): ${SKILL_DOC_SUMMARY[slug]}`,
    ),
    `- [The whole machine contract](${base()}/api/v2/openapi.json)`,
    "",
  );

  return lines.join("\n");
}
