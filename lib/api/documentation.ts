import "server-only";
import { serverSite } from "../site";
// The limits are published from the constants that enforce them: a table
// typed out a second time is a table that goes stale.
import { videoToolsKnown } from "../ingest/video";
import {
  CAPTION_MAX_CHARS,
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  REQUEST_MAX_BYTES,
  VIDEO_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
  VIDEO_SHORT_SECONDS,
} from "../validate/media";
import { TAG_MAX_LENGTH, TRANSPORT_MODES, TRAVEL_SCENE_VARIANTS } from "../validate/entry";
import { COST_CATEGORIES } from "../costFormat";
import {
  BASE_RAPPEN_PER_CREDIT,
  DISCOUNT_FROM,
  CREDIT_STEP,
  MAX_CREDITS,
  MIN_CREDITS,
  formatChf,
  priceRappen,
} from "../credits/pricing";
import { getDefaultUsername, getUser, listedUsernames } from "../users";
import { getTrips } from "../trips";
import { COVER_TYPES, sizesFor } from "../photobook/spec";
import { isIndexable } from "../access";
import { CODE_TTL_MINUTES } from "../auth";
import { openApiDocument } from "./openapi";
// The sentences these documents share with /openapi.json, kept in one place so
// they cannot come to disagree. See the note at the top of that file.
import {
  GUEST_LINK_OFFER,
  LOCALE_LIST,
  NOT_WRITABLE,
  PERFECT_DAY_EXAMPLE,
  PERFECT_DAY_INTRO,
  FRONTMATTER_TO_API,
  MIGRATION_INTRO,
  MIGRATION_RECONCILE,
  PERFECT_TRIP_EXAMPLE,
  PERFECT_TRIP_INTRO,
  TRIP_FIELDS,
  TITLE_COLLISION_EXAMPLE,
  PHOTOS_SECOND_CALL,
  PRIVATE_SHUTS_OUT_GUESTS,
  PUBLISH_OFFER,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
  asSentence,
  dayQuestions,
  firstQuestions,
  numeral,
  scriptIntro,
  tripQuestions,
  wrap,
  type FirstQuestion,
  SECOND_LANGUAGE_COMMITMENT,
} from "./agentCopy";

// The numbered/tabled rendering of a question script is the same shape for
// all three flows — see the journal one just below — so it is written once
// here rather than three times.
function scriptLines(questions: FirstQuestion[]): string[] {
  return questions.flatMap((q, i) => {
    const [head, ...rest] = wrap(`${i + 1}. ${asSentence(q)}`, 78);
    return [head, ...rest.map((line) => `   ${line}`)];
  });
}

/**
 * The document an owner hands to their agent.
 *
 * Generated from the live route table rather than kept as prose in a drawer.
 * A guide that has drifted from the API is worse than no guide: it sends an
 * agent confidently down a path that no longer exists, and the agent has no
 * way to tell.
 *
 * The structure follows llmstxt.org — an H1, a blockquote summary, prose, then
 * H2 "file lists" of links with notes — because that convention also specifies
 * path scoping, which maps exactly onto one document per user. The filename is
 * `documentation.txt` rather than `llms.txt` (decision 25): it is named for the
 * person handing over the link.
 */

function base(): string {
  return serverSite().url;
}

/** The instance-level document: what this is, and who is on it. */
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
  `Übersicht unter ${url}/documentation.txt und der vollständigen Anleitung ` +
  `unter ${url}/agent.md. Du brauchst dafür eine E-Mail-Adresse, die mir ` +
  "gehört.";

export function instanceDocumentation(): string {
  const site = serverSite();
  const questions = firstQuestions(base());
  // Only the journals that asked to be advertised. A `guest` journal — or
  // one still saying the old word, `private` (B306) — is reachable by anyone
  // sent its address and appears on no list, and this document is the first
  // list anybody reads.
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
    "## Already holding a token?",
    "",
    ...wrap(
      `Then call \`GET /api/v1/<user>/status\` first, before anything else on this ` +
        "page. It answers in one call where the journal stands: every trip you may " +
        "write to, every **draft waiting for a person to see it** — each with the " +
        "call that would publish it — which capabilities are on, and a `next` " +
        "saying what to do. It is also the cheapest credential check there is: " +
        "`401` means go and get a code, `200` means you are in.",
      78,
    ),
    "",
    ...wrap(
      "The rest of this document is written for the other case — starting a " +
        "journal that does not exist yet — and an agent handed an existing one " +
        "and asked to *finish what is half done* can read a long way down before " +
        "finding the call that would have answered it immediately. B567.",
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
        "journal — creating one, a trip, a day, publishing it — is HTTP `POST` or " +
        "`PATCH`, sent with an `Authorization: Bearer` header carrying a token. If " +
        "your tools only fetch pages, or fetch only a URL a person pasted into this " +
        "conversation and never one found inside a fetched page, you cannot make " +
        "those calls — no matter how completely the rest of this document is " +
        "written.",
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
    "## Before you call anything, ask",
    "",
    ...wrap(scriptIntro(questions.length), 78),
    "",
    // Rendered from the same list the guide renders as a table — see
    // lib/api/agentCopy.ts. Two hand-written copies of this is how the two
    // documents come to disagree about what an agent should ask.
    ...scriptLines(questions),
    "",
    // The lead-in exists to give "Neither" an antecedent: after a list whose
    // last item is about somebody's name, a bare pronoun points at nothing.
    ...wrap(
      "That third question is about listing, not access. " +
        VISIBILITY_NOT_A_LOCK.replace(/`/g, ""),
      78,
    ),
    "",
    // The consequence, not just the definitions — B302. This document is an
    // index and says nothing about *creating* a trip, but it is where an agent
    // meets the three values for the first time, and the one that surprises
    // people belongs beside them. Backticks stripped, as above: this file is
    // served as plain text.
    ...wrap(PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, ""), 78),
    "",
    "## Then",
    "",
    ...wrap(
      "If they have no journal yet, make one. Three calls, and the first two " +
        "exist only to prove they can read their own email.",
      78,
    ),
    "",
    "```http",
    `POST ${base()}/api/auth/signup/request`,
    "Content-Type: application/json",
    "",
    '{"email": "them@example.com"}',
    "```",
    "",
    "```http",
    `POST ${base()}/api/auth/signup/verify`,
    "Content-Type: application/json",
    "",
    '{"email": "them@example.com", "code": "123456"}',
    "```",
    "",
    ...wrap(
      "That returns a token which creates exactly one journal and is spent by " +
        "doing so — it cannot do anything else, so a taken username is worth " +
        "correcting rather than starting over:",
      78,
    ),
    "",
    "```http",
    `POST ${base()}/api/v1/journals`,
    "Authorization: Bearer fs_signup_…",
    "Content-Type: application/json",
    "",
    '{"username": "their-name", "title": "Their journal",',
    ' "ownerName": "Robin Delacroix-Mbeki", "ownerNickname": "Robin",',
    ' "visibility": "public", "defaultLocale": "de", "locales": ["de", "en"]}',
    "```",
    "",
    "```json",
    '{"ok": true, "user": "their-name", "url": "' + base() + '/their-name",',
    ' "token": "fs_agent_…", "expires": "…", "scope": ["write:content"],',
    ' "next": "POST /api/v1/their-name/trips to create your first trip."}',
    "```",
    "",
    ...wrap(
      "`username`, `title`, `ownerName`, `ownerNickname`, `visibility`, " +
        "`defaultLocale` and `locales` are all required, and none has a default worth " +
        "picking for somebody — ask. The reply carries a write token for the journal it " +
        "just made, so there is no second code. (It also carries `signIn`: a " +
        "one-time link for the person, not for you — read the guide before " +
        "doing anything with it.)",
      78,
    ),
    "",
    ...wrap(
      "If they already have a journal, request a code for the address that owns " +
        `it instead: POST ${base()}/api/auth/request with {"user": "<username>", ` +
        '"email": "…", "kind": "agent"}, then exchange it the same way, at ' +
        "/api/auth/verify.",
      78,
    ),
    "",
    ...wrap(
      "A fresh journal holds nothing to read yet. Three more calls — a trip, a " +
        "day, and the publish that puts it on the site — are the minimum that gets " +
        "something onto it, worth having here rather than only behind a second " +
        "fetch. Ask before the first two; here is what to ask.",
      78,
    ),
    "",
    ...wrap(scriptIntro(tripQuestions().length), 78),
    "",
    ...scriptLines(tripQuestions()),
    "",
    ...wrap(NOT_WRITABLE, 78),
    "",
    ...wrap(PERFECT_TRIP_INTRO.replace(/`/g, ""), 78),
    "",
    "```http",
    `POST ${base()}/api/v1/their-name/trips`,
    "Authorization: Bearer fs_agent_…",
    "Content-Type: application/json",
    "",
    ...PERFECT_TRIP_EXAMPLE,
    "```",
    "",
    ...wrap(scriptIntro(dayQuestions().length), 78),
    "",
    ...scriptLines(dayQuestions()),
    "",
    ...wrap(PHOTOS_SECOND_CALL, 78),
    "",
    ...wrap(PERFECT_DAY_INTRO.replace(/`/g, ""), 78),
    "",
    "```http",
    `POST ${base()}/api/v1/their-name/trips/japan-2027/days`,
    "Authorization: Bearer fs_agent_…",
    "Content-Type: application/json",
    "",
    ...PERFECT_DAY_EXAMPLE,
    "```",
    "",
    ...wrap(
      "This always writes a **draft**: there is no `\"status\"` field you can send, " +
        "and nothing here is on the site yet. The reply carries the `slug` the day " +
        "was filed under — take it from there rather than guessing it from the " +
        `title, which is not always what a title reduces to. ${TITLE_COLLISION_EXAMPLE} ` +
        "Read the day back, tell the person what you wrote, and wait for them to " +
        "say yes. Only then, with that slug:",
      78,
    ),
    "",
    "```http",
    `POST ${base()}/api/v1/their-name/trips/japan-2027/days/lanterns-of-hoi-an/publish`,
    "Authorization: Bearer fs_agent_…",
    "Content-Type: application/json",
    "",
    "{}",
    "```",
    "",
    ...wrap(
      "That is what puts it on the site — yours to call once they have said so, " +
        "not before.",
      78,
    ),
    "",
    ...wrap(PUBLISH_OFFER, 78),
    "",
    ...wrap(GUEST_LINK_OFFER, 78),
    "",
    ...wrap(
      "**`publish` is not an update.** It does exactly one thing — remove the line " +
        "holding a day back — and nothing else. To change a day you already wrote, " +
        "PATCH the same URL as the day itself, not /publish: " +
        `${base()}/api/v1/their-name/trips/japan-2027/days/lanterns-of-hoi-an, with only ` +
        "the field you are correcting in the body. It leaves a draft a draft and a " +
        "published day published — there is no way to change that through this call. " +
        "An earlier agent had no edit endpoint at all, reached for /publish because it " +
        "was the only verb that touched an existing day, and put fifteen unreviewed " +
        "days on somebody's site while reporting them as drafts. If the call you want " +
        "does not exist, stop and say so — do not reach for the nearest verb that " +
        "touches the file. Taking a day back off the site is its own call too: " +
        `POST ${base()}/api/v1/their-name/trips/japan-2027/days/lanterns-of-hoi-an/unpublish, ` +
        "which makes it a draft again and deletes nothing.",
      78,
    ),
    "",
    ...wrap(
      `Read ${base()}/agent.md for everything past this — deleting, photographs, ` +
        "letting other people in, and the fields left out above — with a worked " +
        "example for each. If your tools cannot fetch it — the same limit as " +
        "above, when they follow only a pasted link — ask the person to paste it " +
        "here instead; working that out cost one earlier run several turns it " +
        "should not have needed.",
      78,
    ),
    "",
    "You are the editor here: you write, you publish, you correct. Anything you",
    "create arrives as a **draft** first — not to hold you back, but so the person",
    "can read a day back before it is on the site. Putting it up is a second call,",
    "`POST .../days/<slug>/publish`, and it is yours to make once they say so.",
    "",
    "Ask them, in words, and wait for an answer. Nothing here can check that you",
    "did.",
    "",
    "Do not invent detail. If you were asked for content nobody lived — to check",
    "that this all works — set `test: true` on the trip or the day and the site",
    "will say so itself, in a banner, and keep it out of the feed and the search",
    "index. That is the only way to write something that did not happen.",
    "",
    "## Letting other people in",
    "",
    ...wrap(
      "A journal has no public sign-up form. The journal's owner — never a token " +
        "scoped to one trip — can issue a link that lets somebody else in: " +
        `POST ${base()}/api/v1/their-name/invites with {"kind": "guest"} for a link that ` +
        'reads the journal\'s guest trips, or {"kind": "buddy", "trip": "<trip-id>"} for ' +
        "one that leads to writing to a trip. Neither grants anything by itself — whoever " +
        "opens one still has to be approved. Read /agent.md's \"Letting other people in\" " +
        "for what each does and the worked example.",
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
    "## Machine-readable",
    "",
    `- [Agent guide](${base()}/agent.md): how to authenticate and write, with worked examples`,
    `- [OpenAPI](${base()}/openapi.json): the same API as a machine contract`,
    "",
    // Where the content comes from, for an agent handed an account and no
    // material. The owner's prompt is quoted because it is what this site
    // gives them to copy — recognising it is what tells an agent it is at the
    // very beginning rather than halfway through a journal.
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
    "the day as markdown rather than as a rendering. The prose *is* markdown, so",
    "nothing happens to it on the way out — there is no conversion — and that",
    "includes `translations:` in full, on a day written in more than one language.",
    "",
    "**It is a reader's view, not the file.** The frontmatter it carries is the",
    "part a reader needs — title, date, time, place, coordinates, how many",
    "photographs — and it leaves out `countryCode`, `tags`, the transport block,",
    "`travelScene`, `costs` and the `gallery` list, while adding a `photos:` count",
    "and, on test content, the banner saying so. It is also public: a trip that is",
    "not `public` has no twin at all, and a valid token does not open one, because",
    "this route is the thing an anonymous browser can read.",
    "",
    "So use it to read prose back, and use `GET /api/v1/<user>/trips/<trip>/days/",
    "<slug>` — which takes your token — when you want to check that a field you",
    "sent actually landed. That call answers with every field the day carries.",
    "",
    // A worked URL, from a trip that actually exists here. The pattern alone
    // sent an agent to `/<user>/day/<slug>.md` for a day in a past trip and it
    // 404'd, because a day's URL carries its trip.
    ...(trips.length > 0
      ? [
          "```",
          `${root}/trips/${trips[0].id}/day/<slug>.md`,
          "```",
          "",
          "A day's URL carries its trip, so the twin does too. `<slug>` alone is not a",
          "day's identity — the search index below names entries `<trip-id>/<slug>`.",
          "",
        ]
      : []),
    "## Writing to this journal",
    "",
    "```",
    `POST ${base()}/api/auth/request`,
    `     {"user": "${username}", "email": "<the owner's address>", "kind": "agent"}`,
    "     -> 202 when a code is on its way; 403 not_authorised if that address does",
    "        not own this journal and is not on the trip you named.",
    "",
    `POST ${base()}/api/auth/verify`,
    `     {"user": "${username}", "email": "…", "code": "123456", "kind": "agent"}`,
    '     -> {"token": "fs_agent_…", "expires": "…", "scope": ["write:content"]}',
    "",
    "Then send `Authorization: Bearer <token>` with every call below.",
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
    `- [Trips](${base()}/api/v1/${username}/trips): every trip, including ones the public cannot see`,
    `- [Days](${base()}/api/v1/${username}/trips/<trip-id>/days): read them, or POST to add one as a draft`,
    `- Editing a day: PATCH the day's own URL (${base()}/api/v1/${username}/trips/<trip-id>/days/<slug>) with the field you are correcting — never \`/publish\`, which is not an update and cannot be used to change one`,
    `- Taking a day back off the site: POST ${base()}/api/v1/${username}/trips/<trip-id>/days/<slug>/unpublish — it becomes a draft again and nothing is deleted`,
    `- [Drafts](${base()}/api/v1/${username}/drafts): everything waiting for a person to approve`,
    `- Trips: POST to [the same URL](${base()}/api/v1/${username}/trips) to create one (owner only; defaults to this journal's own visibility)`,
    `- [Invites](${base()}/api/v1/${username}/invites): POST \`{"kind":"guest"}\` for a link that lets somebody read the journal's \`guest\` trips, or \`{"kind":"buddy","trip":"<trip-id>"}\` for one that leads to writing to a trip — owner only, see "Letting other people in" in the agent guide`,
    `- [Travellers](${base()}/api/v1/${username}/travellers/presets): the vocabulary a traveller is drawn in, and twelve starting points; \`…/travellers/preview?figure={…}\` answers with the picture, so somebody can see themselves before it is written down`,
    `- Deleting: DELETE [a trip](${base()}/api/v1/${username}/trips/<trip-id>) or [the journal](${base()}/api/v1/${username}) — owner only, and neither deletes anything: the owner is mailed a link with a button on it, so a 202 means the mail was sent`,
    `- [Search index](${root}/search-index.json): every public entry, for finding things`,
    `- [Feed](${root}/feed.xml): public entries as RSS`,
    `- [Export](${root}/export.zip): the whole journal as markdown and photographs`,
    "",
    ...wrap(PRIVATE_SHUTS_OUT_GUESTS.replace(/`/g, ""), 78),
    "",
    "## The guide",
    "",
    `- [Agent guide](${base()}/agent.md): the full instructions, with examples`,
    "",
  );

  return lines.join("\n");
}

/**
 * The full guide.
 *
 * Written out here, next to the route handlers it describes, so that changing
 * an endpoint and forgetting the documentation is a visible omission in the
 * same file rather than a silent drift across the repository.
 */
/**
 * The day's fields, one line each, from the schema the API publishes.
 *
 * B540: a weak model given this guide sent `prose` and `slug`, because the
 * field names live in brackets after an English label — `**What happened, in
 * their words** (\`content\`)` — a third of the way down a long page. It found
 * the right names by being refused, twice. The sentences are worth keeping;
 * what was missing was somewhere to *look the names up*, which is a table, and
 * generating it from `components.schemas.Draft` means it cannot drift from the
 * thing that refuses.
 */
function dayFieldRows(): string {
  const doc = openApiDocument() as unknown as {
    components: {
      schemas: {
        Draft: { required?: string[]; properties?: Record<string, { description?: string; enum?: string[]; type?: string | string[] }> };
      };
    };
  };
  const draft = doc.components.schemas.Draft;
  const required = new Set(draft.required ?? []);
  return Object.entries(draft.properties ?? {})
    .map(([name, field]) => {
      const first = (field.description ?? "").split(/(?<=\.)\s/)[0].replace(/\n/g, " ").trim();
      const said = field.enum ? `One of ${field.enum.join(", ")}. ${first}`.trim() : first;
      return `| \`${name}\` | ${required.has(name) ? "**required**" : ""} | ${said || "—"} |`;
    })
    .join("\n");
}

/**
 * The video row of the limits table, which depends on the machine — B692.
 *
 * `/agent.md` is rendered per request and per instance, so it can say what is
 * true here rather than what the constants describe. An agent told to send mp4
 * by a server that will refuse every one of them has been sent to do work that
 * cannot land, and it only finds out after the upload.
 */
function videoRow(): string {
  const formats = VIDEO_FORMATS.join(", ");
  // The cached answer, never the spawning one — this page is public and
  // unauthenticated, and B695 is what that cost. `null` reads as "probably
  // fine", the same way `/api/health` treats it.
  if (videoToolsKnown() === false) {
    return (
      `**not accepted on this instance.** ffmpeg and ffprobe are not installed, so a ` +
      `clip cannot be converted for the browser. Send the photographs, and tell the person ` +
      `running this instance if they wanted clips — it is one package. Everything else on this ` +
      `page is unaffected`
    );
  }
  return (
    `${formats} — at most ${(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)} MB and ` +
    `${VIDEO_MAX_SECONDS}s. Longer than about ${VIDEO_SHORT_SECONDS}s still goes in whole — ` +
    `nothing is cut — and the response says so in \`advice\`, because a short clip is the one ` +
    `a reader watches and the one that costs them less on mobile data`
  );
}

export function agentGuide(): string {
  const site = serverSite();
  // The same list `/documentation.txt` renders as a numbered list, rendered
  // here as a table. One source, two shapes — see lib/api/agentCopy.ts.
  const questions = firstQuestions(site.url);
  // A listed journal, so the worked examples below cannot be the one place an
  // unlisted journal's address gets published.
  const example =
    getDefaultUsername() ?? listedUsernames()[0] ?? "your-username";

  return `# Writing to ${site.name} as an agent

You are reading this because somebody gave you a link and an email address and
asked you to keep their travel journal. This document is everything you need.

## What this is

A travel journal. Content is markdown files and photographs in a folder the
author owns. **There is no editing interface** — no web form, no upload widget,
no CMS. Writing happens through the API below, which is why you are here.

## The one rule

**You are the editor.** You write, you publish, you correct. There is no web
form and no CMS behind you, so anything you will not do on the owner's behalf
is a thing that cannot be done at all.

**What you write arrives as a draft**, and \`POST .../days\` has no argument
that changes that. Not to hold you back — so that there is a moment where the
person can read a day back before it is on the site. Publishing is the second
call, \`POST .../days/<slug>/publish\`, and it is yours to make.

**And it comes back off with \`POST .../days/<slug>/unpublish\`.** The
day becomes a draft again: off the site, off the feed, off the sitemap, still
on disk with every word and every photograph, and publishing it again puts it
back. It is not a delete and needs none of deletion's ceremony. What it cannot
do is reach somebody who already read the day or was sent it, and that is worth
saying plainly to anybody who asks for a takedown because they are worried
about who saw it.

**\`publish\` is not an update, and there is no other way to change a day
except \`PATCH .../days/<slug>\`.** An agent that had written fifteen days and
was then asked to add coordinates found no editing endpoint, reached for
\`/publish\` because it was the only verb that touched an existing file, and
put all fifteen on the site while reporting them as drafts. \`publish\` does
exactly one thing — remove the line holding a day back — never more and never
less; \`PATCH\` is what corrects a day, and it cannot publish or unpublish
one, whatever you send it (see **Editing a day**, below). If neither call does
what you need, say so and stop — do not reach for the nearest verb that
touches the file.

**Which is why the asking is on you.** Nothing here can tell whether they
actually said yes, so: **ask them, in words, and wait for an answer.** "It
looks finished" is not consent, and neither is silence.

Write what you were told. Do not invent detail to fill a page — no weather you
were not told about, no meals nobody mentioned, no feelings nobody expressed.
If you do not know where a photograph was taken, leave the location empty and
say so.

**Unless you were asked to invent it.** There is one honest reason to write a
day nobody lived: proving that all of this still works, end to end. Set
\`"test": true\` on the day, or on the whole trip, and the site puts an
unmissable banner on it and keeps it out of the feed, the search index and the
sitemap. Do that rather than writing a warning into the prose — a sentence you
chose to add is not a guarantee, and the next person to read the page has no
way to know whether you added one.

**It comes back on every read, so check it stuck.** \`GET .../trips\` shows
\`"test": true\` on the trip, reading a day back shows it on the day — including
a day that inherits it from its trip — and the day's \`.md\` twin carries it in
the frontmatter *and* says so above the prose. If you set the flag and do not
see it, it did not take: say so rather than assuming.

**And if you are the one reading:** a twin that opens with "this day did not
happen" is not a record of anything. Do not summarise it, quote it or carry it
into anything else as fact.

## Ask these ${numeral(questions.length).toLowerCase()} things first

${scriptIntro(questions.length)}

| Ask | Because |
| --- | --- |
${questions.map((q) => `| ${q.ask} | ${q.because} |`).join("\n")}

**Public or guest** is the one nobody thinks to ask, so ask it. To say it
once more, because the table above is easy to skim past:

${wrap(VISIBILITY_MEANING.charAt(0).toUpperCase() + VISIBILITY_MEANING.slice(1)).join("\n")}

${wrap(VISIBILITY_NOT_A_LOCK).join("\n")}

So "guest journal" means *unlisted*, not *locked* — and if this reads as the
same question the trip's own \`visibility\` asks, it should: \`guest\` used to be
called \`private\` here too, one level up from where it means something
narrower, and that was the confusion B306 exists to fix. If what they want is
a journal only invited people can read at all, the answer today is a journal
of private or guest trips — say that plainly rather than implying more.

**The username is worth the same slowing down.** It is the journal's own
name, never a trip's, and it is permanent. Never invent one, and never
illustrate it either — an example inside the question you ask is a
suggestion, and "asia-2025" is a trip's name that somebody would be stuck
with as their journal's address.

## Starting from nothing

If the person you are working for has no journal yet, make one. Three calls,
and the first two exist only to prove they can read their own email.

\`\`\`http
POST ${site.url}/api/auth/signup/request
Content-Type: application/json

{"email": "them@example.com"}
\`\`\`

\`\`\`http
POST ${site.url}/api/auth/signup/verify
Content-Type: application/json

{"email": "them@example.com", "code": "123456"}
\`\`\`

That returns a token which creates **exactly one journal** and is spent by doing
so. Unused, it expires in twenty minutes. A refused creation does not spend it,
so a taken username is worth correcting rather than starting over:

\`\`\`http
POST ${site.url}/api/v1/journals
Authorization: Bearer fs_signup_…
Content-Type: application/json

{"username": "their-name",
 "title": "Their journal",
 "ownerName": "Robin Delacroix-Mbeki",
 "ownerNickname": "Robin",
 "visibility": "public",
 "defaultLocale": "de",
 "locales": ["de", "en"],
 "tagline": "optional"}
\`\`\`

\`\`\`json
{"ok": true, "user": "their-name", "url": "${site.url}/their-name",
 "visibility": "public", "welcomeMailed": true,
 "signIn": "${site.url}/their-name/s/…",
 "signInNote": "Give this to the person, once, in your reply. …",
 "token": "fs_agent_…", "expires": "…", "scope": ["write:content"],
 "next": "POST /api/v1/their-name/trips to create your first trip."}
\`\`\`

**\`signIn\` is for them, not for you.** Put it in your reply so they can open
their journal without going to their inbox — it signs them in, which is what
lets them see drafts and private trips. It works **once** and expires in
fifteen minutes. \`signInNote\` beside it is the same instruction in one
sentence, there so it survives being pasted into a log.

**Their welcome mail carries a second link, not this one.** It leads to the
same place and it is a different token with a different lifetime: the one you
are holding dies in fifteen minutes, and the mailed one does not expire on a
clock. Both are **single use** — the mailed one is not standing, whatever it
sounds like. A mail scanner that opens links before the reader does can spend
it first, and the reader then lands on "that link had already been used"
having never touched it themselves (B142) — the same reason the site's own
sign-in page explains this rather than assuming a dead link means something
went wrong. The **six-digit code is the reliable route**; hand that over, or
tell them to ask for one, when the link might already be gone.

The one real difference: asking this server for a fresh ordinary sign-in code
for that address invalidates any relayed link that has not been used yet, but
the welcome mail's link survives that. One live code per address is the rule
for everything else; this link alone is exempt, because it is the owner's
first way in and may sit unopened for a week while they request other codes in
the meantime.

Three rules about the one you are holding, and they are not fussiness:

- **Give it to the person, once, immediately.** Do not repeat it later in the
  conversation, do not store it anywhere, and do not hold it back for the end
  of a long reply — it dies in fifteen minutes, and a fresh code request for
  that address kills it sooner.
- **Never hand it over as "the address of your journal".** That is \`url\`.
  Somebody forwarding what they think is an address would be forwarding a
  session.
- **Do not follow it yourself.** It is single use; opening it to check it works
  spends it, and the person gets a dead link.

**All seven of \`username\`, \`title\`, \`ownerName\`, \`ownerNickname\`,
\`visibility\`, \`defaultLocale\` and \`locales\` are required**, and none of
them is guessable — a request missing any of them is refused rather than
filled in on somebody's behalf. \`ownerNickname\` is what the site calls this
person in its own voice — "Robin", not "Robin Delacroix-Mbeki" — and it is
never derived from \`ownerName\`, because taking the first word mangles any
name whose given name is not first. Ask.

**Ask even when the owner is the person in front of you.** Somebody setting up
their own journal will give you their name in the same breath, and the rule
above still holds — it forbids *deriving* a nickname, not asking for one, and
"what should the site call you?" is one short question about themselves that
they can answer instantly. There is no default and there will not be one.

\`visibility\` has no default either — send \`"public"\` or \`"guest"\` and
nothing else, and get one of those two answers from the person before you
call this. See the table above for what the two mean. This document used to
say silence read as \`"public"\`; it did, and a journal asked to be unlisted
was created public because of it (B263). It no longer does — the request is
refused instead.

\`defaultLocale\` is **their** language — ${LOCALE_LIST} on this instance —
and it decides the language of the site's chrome **and of the welcome mail
this server sends the owner the moment the journal exists**. It has no
default either, for the same reason: a German journal created without it used
to greet its owner in English, silently. Ask, and pass the code.

\`locales\` is a different question, and required for the same reason as the
two above it: which of those same languages **a reader** may switch the
journal into — \`["de", "en"]\` above, meaning the journal reads in Deutsch or
English depending who is looking. It is not the owner's own language
repeated; their audience is not necessarily the same, so ask both — a journal
created without an answer has no language switcher at all, which is right for
no audience. It must include \`defaultLocale\`: a journal whose own language
is not on offer to its own readers is refused rather than written that way
(B277 — the field used to default silently, and one owner asked for three
languages and was given one).

${SECOND_LANGUAGE_COMMITMENT}

The reply carries an **agent token for the journal it just made**, so you can
go straight on to creating a trip — no second code. It also carries
\`welcomeMailed\`: this server mails the owner the journal's address when it is
created, and if that says \`false\` the mail did not go and you should give them
the URL yourself.

**Ask them for the username, and never invent or illustrate one.** It is the
address of their site and cannot be changed afterwards — picking one for
them, or even offering an example, is the sort of thing they will live with
for years. Lowercase letters, digits and dashes.

One address may own three journals on this server.

### If it turns out they already have one

"Set up my travel journal" from somebody who set one up last month is the same
sentence, so expect this. \`POST /api/v1/journals\` answers **\`409
username_taken\`** for a name that exists, and the signup token you are holding
cannot do anything else — it creates journals and nothing more.

Do not pick a different name. \`alex-2\` is somebody living with a second-choice
address forever because an agent did not stop to ask. **Stop and ask** whether
the existing journal is theirs, and if it is, take the other path: they need a
write token for it, not a new journal.

\`\`\`http
POST ${site.url}/api/auth/request
Content-Type: application/json

{"user": "their-existing-journal", "email": "them@example.com", "kind": "agent"}
\`\`\`

The 409 says this too. It cannot say whether the journal is *theirs* — this
server does not know, and checking would make journal creation a way of asking
which addresses own which names — so the answer has to come from the person.

**A note on names.** The path segment and the auth calls say \`user\`; journal
creation says \`username\`. Same value: the journal's address, the thing between
the domain and the rest of the URL.

## If you were handed a key rather than told to ask for a code

An owner can copy a whole prompt out of their journal's access page, and it
carries a **handover credential**: twenty minutes, single use, and good for
exactly one call. Spend it first and it becomes a seven-day token of your own.

\`\`\`http
POST ${site.url}/api/auth/handover
Authorization: Bearer fs_handover_…
\`\`\`

The answer carries \`token\` — that is yours for seven days, on that journal and
nothing else — and the \`status\` URL to read next. A **401 \`invalid_handover\`**
means it has expired or was already spent: ask the person to press the button
again. Nothing is wrong with the journal, and there is nothing to retry.

Do not try to use a handover credential on anything else. Every read and every
write refuses it, by design, and it is not a fallback for a token you have
mislaid — for that, go through the code below.

## First, get your bearings

Two calls before you do anything, in this order, and the first one is free.

**1. Do you already hold a live token?** Ask for status. A \`200\` means you are
in and the answer *is* your bearings; a \`401\` means go and authenticate below.
Nothing else tells you this as cheaply.

\`\`\`http
GET ${site.url}/api/v1/${example}/status
Authorization: Bearer fs_agent_…
\`\`\`

**2. Read what it says, once, and work from it.** It carries the journal, every
day still waiting for a person to approve it — with the exact call that
publishes each — every trip you may write to, which of this server's
capabilities are on, and a \`next\` saying what to do. Whether you are holding
the whole journal or one trip's slice is stated in \`scope\`, so do not report a
slice as the journal's total.

That is one call instead of four, and it is the difference between an agent
that notices three drafts already waiting for approval and one that writes a
fourth on top of them.

## Authenticating

Two calls. The token is never sent by email — only a short-lived code is, and
you exchange it over HTTPS.

\`\`\`http
POST ${site.url}/api/auth/request
Content-Type: application/json

{"user": "${example}", "email": "owner@example.com", "kind": "agent"}
\`\`\`

Answers \`202\` when a code is on its way, and **\`403 not_authorised\` when that
address is neither the journal's owner nor listed on the trip you named** — so
you are told, rather than waiting for a code that was never going to arrive.
A **\`503 mail_disabled\`** means this server cannot send mail at all: nothing
was issued, any code the person already holds is still live, and there is
nothing to retry until an operator turns mail on.
Ask the person for the six-digit code that arrives in their inbox. It lasts
${CODE_TTL_MINUTES} minutes, is single use, and burns after five wrong guesses.

**Asking again invalidates the code you already asked for.** Only the newest is
live, and two of these mails are word for word identical apart from the time
printed in them. So if you request twice — because the first attempt looked
like it failed, or because the person was slow to find it — say clearly that
they must read out the *newest* mail, or you will spend one of their five
guesses on a code that was correct half an hour ago.

A \`503 mail_failed\` means this server could not send it at all, and **no code
is live**: nothing was consumed and nothing is waiting in their inbox. Retry.
That is different from \`429\`, which means wait, and from \`404\`, which means
this server does not do tokens.

**If the person is not the journal's owner but came on one of its trips**, name
the trip when you ask for the code:

\`\`\`json
{"user": "${example}", "email": "robin@example.com", "kind": "agent", "trip": "asia-2026"}
\`\`\`

**The trip is decided there and travels on the code.** Verifying takes it from
the code, so you may repeat it below or leave it out and get the same token
either way — what you cannot do is change it. A verify that names a *different*
trip is refused with the ordinary \`401 invalid_code\` and spends nothing: ask
for a fresh code naming the trip you actually want. (Until this was fixed,
leaving the field out returned the owner's own journal-wide token to somebody
who had been let onto one trip.)

The token you get back writes to **that trip only** — every day of it, not
just theirs — and every other trip in the journal answers as if it did not
exist. Who is on a trip is the \`people:\` block in its \`trip.md\`, plus anyone
the owner has let on with a **buddy link** (below). You cannot add either;
a person types the name into the file, or the owner issues the link and
approves whoever follows it.

The journal's **owner** may name a trip at either call, and gets a token for
that trip alone — a deliberately limited credential to hand to somebody, or to
bound what you yourself can reach. Naming no trip is what produces the
unqualified \`write:content\` below.

\`\`\`http
POST ${site.url}/api/auth/verify
Content-Type: application/json

{"user": "${example}", "email": "owner@example.com", "code": "123456", "kind": "agent"}
\`\`\`

\`\`\`json
{"ok": true, "token": "fs_agent_…", "expires": "…", "scope": ["write:content"]}
\`\`\`

The token writes for **seven days** and is scoped to that one journal. Send it
as \`Authorization: Bearer <token>\`. Do not put it in a URL, do not store it in
a file the author did not ask for, and tell them if you no longer need it — they
can revoke it.

**Seven days is a floor, not a ceiling, and the owner should know which you are
doing.** Holding an owner's live token, \`POST
${site.url}/api/v1/<user>/handover\` accepts that token — cookie *or* bearer —
and hands back a credential you spend for a fresh seven-day one. An agent that
keeps working can therefore keep itself alive with the person never seeing
another code. That is deliberate, and every renewal is a new row on the owner's
access page at \`${site.url}/<user>/me\`, which is where they end it. What it
asks of you is one sentence of honesty: if you intend to keep renewing, **say
so**, rather than letting "seven days" be heard as "this stops by itself".

A token scoped to one trip cannot do this — \`handover\` carries the journal, and
widening a buddy's reach is exactly what it refuses.

**And you can end your own key, without asking anybody.**

\`\`\`http
GET  ${site.url}/api/v1/<user>/keys
POST ${site.url}/api/v1/<user>/keys      {"revoke": "<id>"}
\`\`\`

The \`GET\` lists the live keys you may see — the owner's token sees all of
them, a trip-scoped one only its own address's — with scope, expiry and when
each was last used, and never the tokens themselves. The \`POST\` ends one at
once, **including the one you are holding**: the call after it is a \`401\`.

When a job is finished and nobody asked you to keep writing, end your own key
rather than leaving it live for the week. A lost token expires in seven days; a
revoked one is over now.

## A web helper exists too, and it is not part of this contract

If you see \`/api/helper/<user>/...\` mentioned anywhere — a screenshot, a log,
somebody's description of the site — that is not a door you can use. Since
B682/B684 this instance also carries a guided web wizard at \`/agent\` for a
person with no agent of their own: it drives the same \`lib/api/*\` functions
this document describes, but through its own routes, under its own rules.

Those routes are **cookie-only, owner-only, and outside this document on
purpose**. Every one of them resolves the caller from a signed-in browser
session and nothing else — an \`Authorization: Bearer\` header is not merely
checked and refused, the code never reads it — so a token issued to you here
cannot drive them, and there is nothing you are missing by not being able to.
Whatever the wizard can do, some call above already does, because the wizard
has no privilege beyond what \`/api/v1\` grants an owner's own token: drafting a
day, attaching photographs, and publishing, each through the identical
functions \`POST .../days\`, \`.../media\` and \`.../publish\` reach. They are not
in \`/openapi.json\` for the same reason: a route only a signed-in browser can
ever call is not part of the API contract, and listing it would suggest a
credential you could present to reach it.

## Reading

You do not need a token to read anything public.

| | |
| --- | --- |
| \`GET /${example}/documentation.txt\` | this journal's own summary |
| \`GET /${example}/trips/<trip-id>/day/<slug>.md\` | a day's markdown source |
| \`GET /${example}/day/<slug>.md\` | the same, for the current trip |
| \`GET /${example}/search-index.json\` | every public entry, for finding things |
| \`GET /${example}/feed.xml\` | public entries as RSS |

**The \`.md\` twin is the day page's own URL with \`.md\` on the end**, and a day's
URL carries its trip. The search index identifies entries as
\`<trip-id>/<slug>\` for the same reason: a slug is unique within a trip, not
within a journal. The short form works too and falls back to the journal's
other trips when the current one has no such day — but if you have the trip id,
use it. A miss answers plain-text \`404\`, never an HTML error page.

A day written in more than one language carries a \`translations:\` block in
the twin too, the same shape it was written in, in its own default language and
never re-led with whichever locale you asked for.

**The twin is a reader's view, not the file**, and it is public: it leaves out
\`countryCode\`, \`tags\`, the transport block, \`travelScene\`, \`costs\` and the
\`gallery\` list, and a trip that is not \`public\` has no twin at all — a valid
token does not open one, because this is the route an anonymous browser reads.

### Picking up somebody else's journal

If you were handed a token and a journal and asked to *see where it is up to*,
**\`GET /api/v1/${example}/status\` is the whole first step.** It names every
trip you may write to, every draft waiting — with the call that would publish
each one — and what to do next. You should not have to go hunting across the
routes below to find out what exists.

If a \`trip.md\` you just wrote is too broken to parse, it shows up here too,
under \`malformed\` — the same list \`GET .../trips\` carries — so a write that
did not take is something you find out from the first call rather than by the
trip quietly not existing anywhere you look. Owner tokens only.

Two things it will not tell you, and nothing else will either. **The owner's
email address is returned by no call**; if your token has expired, ask the
person. And there is **no history**: nothing records why a day was left as a
draft, or what the last agent meant to do. If the answer matters, it is a
question for the person rather than a call.

### Reading your own work back

These take your token and answer with everything, which is what you want when
checking that a field you sent actually landed:

| | |
| --- | --- |
| \`GET /api/v1/${example}/status\` | where you stand: drafts waiting, trips you may write to |
| \`GET /api/v1/${example}/config\` | the journal's own settings, and every capability it asks for |
| \`GET /api/v1/${example}/trips\` | every trip, in summary |
| \`GET /api/v1/${example}/trips/<trip-id>\` | **one trip, whole** — including \`accent\`, \`costsVisibility\`, \`intro\`, \`translations\`, \`people\`, \`travellers\`, \`rates\` and \`tracks\`, which the summary above does not carry |
| \`GET /api/v1/${example}/trips/<trip-id>/days/<slug>\` | one day, every field it has |
| \`GET /api/v1/${example}/trips/<trip-id>/costs\` | the budget and what was spent before leaving |

**Read a thing back before you tell somebody it is done.** A \`201\` says the
call was accepted; it is the read that says what is there.

## Letting other people in

A journal has no public sign-up form, on purpose. Two links get somebody in,
and **only the journal's owner can issue either** — not a token scoped to one
trip.

\`\`\`http
POST ${site.url}/api/v1/${example}/invites
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"kind": "guest", "email": "sister@example.test"}
\`\`\`

\`\`\`json
{"ok": true, "invite": {
  "id": "…", "kind": "guest", "scope": "${example}", "trip": null,
  "expiresAt": "…",
  "url": "${site.url}/${example}/invite/guest/fs_inv_…"
}, "sent": true, "note": "Mailed to sister@example.test. That address is pre-approved: proving it is all that is left, and it will not sit in your queue."}
\`\`\`

| | \`guest\` | \`buddy\` |
| --- | --- | --- |
| URL | \`/${example}/invite/guest/<token>\` | \`/${example}/invite/buddy/<token>\` |
| Leads to | reading the journal | **writing to one trip** |
| Scope | the whole journal | one trip — \`{"kind": "buddy", "trip": "<trip-id>"}\` |
| Opens | every trip marked \`guest\`, never a \`private\` one | that trip, and the journal's \`guest\` trips |

**Say out loud which one you are handing over.** A guest link is for the
family: safe to forward, safe in a group chat, and everyone who opens it asks
separately. A **buddy link grants write access** once approved — it is for the
people who were actually on the bus, and it is not the one to paste into a
group chat. If the person has not said which they meant, ask.

**Neither link grants anything by itself.** Whoever opens one proves their own
address and lands in the owner's queue at \`${site.url}/${example}/contacts\`;
the owner approves each person by hand. So report a link as *an invitation to
ask*, never as "your sister now has access".

**You cannot look at that queue yourself.** \`${example}/contacts\` and
\`${example}/me\` are the owner's own pages, and they authenticate from a
browser cookie session only — the bearer token that drives every call above
renders neither. Tell the owner a request is waiting and where to look;
do not try to confirm it by fetching the page.

**Naming \`email\` changes that, on purpose.** The owner is no longer handing
over a link for somebody to open eventually — they are typing an address and
asking the server to mail it, which is the owner vouching for that address.
Whoever proves *that exact* address at the landing page is admitted straight
through: no queue, no second decision. It is still not "they are already
in" — proving the address is theirs to do, and a wrong or forwarded address
still just asks, exactly as before pre-approval existed.

**A failed send still returns a usable link.** \`sent\` says whether the mail
actually left; \`sent: false\` does not mean the invitation failed — the link
and, when \`email\` was given, its pre-approval both already exist by the time
this responds. Read \`invite.url\` and hand it over another way rather than
telling the owner nothing happened.

The token is in the response **once** — in this API call. Do not save it
anywhere the person did not ask for, and do not read it back to them as a
credential. Where this journal has a contacts encryption key configured, the
owner's own \`${example}/contacts\` page can show the link again later — B280
put a reversible copy beside the hash, for exactly this — so a lost link is not
always a reissue; point the owner there first. Without that key, the old rule
still holds: only the hash is stored, and a lost link can only be reissued.

\`GET /api/v1/${example}/invites\` lists what has been issued, without the
tokens. \`DELETE /api/v1/${example}/invites/<id>\` revokes one: the link stops
working and **everybody already approved stays in**. That is the whole reason
these exist rather than a shared password, which could only be changed for
everyone at once. Every link is dated; ask for a different window with
\`{"days": 7}\`.

### If invites are switched off for this journal

They can be switched on, and by you — a journal's capabilities used to be fixed
at the moment it was created:

\`\`\`http
PATCH ${site.url}/api/v1/${example}/config
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"features": {"contacts": true}}
\`\`\`

Owner only. It can only ask for what this server already provides: if the
operator has not configured a capability, the call is refused and says which
piece is missing rather than writing something that would quietly do nothing.
Switching a capability *off* always works. \`GET\` the same URL to see what the
journal asks for now, and \`/api/health\` for what the server can actually give
it. **Ask the person before switching anything on.**

The same URL changes what the journal **says about itself** — a title typoed
at signup used to be permanent without a shell on the server:

\`\`\`http
PATCH ${site.url}/api/v1/${example}/config
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"title": "A slow loop", "tagline": "six weeks by train", "locales": ["de", "en"]}
\`\`\`

\`title\`, \`tagline\`, \`visibility\`, \`startLocation\`, \`units\`, \`locales\`,
\`defaultLocale\`, \`displayCurrencies\`, \`manualRates\` and \`ownerTel\`. Send only
what you are changing; \`""\` clears a tagline, a start location or the number. Capabilities and these are
**two calls** — a body naming both is refused rather than half-applied, because
each call rewrites \`config.json\` whole and puts it back if it does not load.
\`GET\` returns all of it under \`journal\`.

\`locales\` and \`defaultLocale\` take the languages this instance maintains —
${LOCALE_LIST} — and nothing else, which is the same set creation refuses
outside of. A code with no strings behind it would leave a reader looking at
English chrome with no way to tell why.

Three keys are refused, and each says why. **\`owner.email\`** is the address that
decides who can get a token for this journal, so a token cannot move it.
**\`baseCurrency\`** is not a display setting: a cost written without a
\`currency:\` *is* a cost in the base currency, so changing it would not
reconvert the money, it would change what every amount already recorded means.
**\`media\`** is the operator's — the server's own limits are already a ceiling
over it. All three are an edit at the file, by whoever runs the server.

One part of the \`owner\` block *is* yours to write, as the flat field
\`ownerTel\`: the owner's own telephone number. It is where their own WhatsApp
copy of a published day goes, and that copy costs no credits — as their own
copy of the day's letter does not either. Without a number the owner is the
one person this channel cannot reach, including for checking it works before a
guest ever sees it. Include the country code — \`+41 76 561 31 50\` — because a
national number means a different telephone in every country and is refused
rather than guessed at. Do not invent one: ask for it, or leave it absent.

A journal's \`visibility\` is only whether this instance *advertises* it — the
landing page, \`/documentation.txt\`, the sitemap. A \`guest\` journal (\`private\`
before B306, still accepted) is unlisted, not locked; who may read a journey
is still that trip's own visibility, though this is also the answer a new
trip in it gets by default. **Ask before making one public.**

## Writing

\`\`\`http
GET ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…
\`\`\`

A day needs a trip to live in. If there is none yet, make one — only the
journal's owner can, and a trip-scoped token cannot. ${scriptIntro(tripQuestions().length)}

| Ask | Because |
| --- | --- |
${tripQuestions().map((q) => `| ${q.ask} | ${q.because} |`).join("\n")}

${wrap(PRIVATE_SHUTS_OUT_GUESTS).join("\n")}

${wrap(NOT_WRITABLE).join("\n")}

${wrap(PERFECT_TRIP_INTRO).join("\n")}

\`\`\`http
POST ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…
Content-Type: application/json

${PERFECT_TRIP_EXAMPLE.join("\n")}
\`\`\`

Every field, and whether it is required:

| | | |
| --- | --- | --- |
${TRIP_FIELDS.map((f) => `| \`${f.key}\` | ${f.absent ? "not a field" : f.required ? "**required**" : "optional"} | ${f.what} |`).join("\n")}

A title or a tagline must be one line — both are written as a single line of
the trip's frontmatter, and a request carrying a line break in either is
refused rather than written. If you wrote a \`trip.md\` yourself rather than
posting here, read the list back: a folder the site refused comes back under
\`malformed\`, saying what is wrong with it, instead of quietly not being there.

## Drawing the travellers

Every journal opens with figures walking. Who they are is the \`travellers\`
block — on the trip, or in the journal's config as a default. Absent means one
neutral figure.

\`\`\`http
GET ${site.url}/api/v1/${example}/travellers/presets
\`\`\`

That is the whole vocabulary — skin tones, hair colours and styles, eyes,
build, age, clothing, accessories — and twelve **starting points**. Use it
rather than inventing a hex code; any colour field also takes one, but a token
is what a person can read back.

**Ask, and never infer.** A person telling you their own hair is short and
black is stating a fact about themselves, and writing it down is the job.
Guessing it is not. Not from a name, not from a photograph on the trip, not
from a country — and an attribute nobody answered gets the **default**, which
you then say out loud, rather than a plausible guess. Ask once, openly — *how
would you like to be drawn?* — rather than walking somebody through twelve
fields.

**Show them before you write.** A person cannot confirm a description they
cannot see, and reading \`skin: medium-deep, hairStyle: braids\` down a phone
is not confirmation:

\`\`\`http
GET ${site.url}/api/v1/${example}/travellers/preview?figure={"skin":"deep","hairStyle":"coils"}
GET ${site.url}/api/v1/${example}/travellers/preview?party=[{…},{…}]
\`\`\`

It answers with \`image/svg+xml\` and nothing else — no form, no controls.
There is no character editor in the browser and there will not be one; \`party\`
draws the group exactly as the hero will arrange it, which is worth showing
once there is more than one of them.

**A starting point resolves when it is picked, and its name is never written.**
Send the attributes under \`resolve\`, not the name. \`preset\` is refused by
name, because a preset name in a trip file is a claim about somebody's
background that the owner did not think they were making — and one that stops
being true the moment they change the hair.

There is deliberately no \`gender\` field. Everything it would control is
already chosen directly — hair style and length, \`outfit\`, clothing colours,
\`build\` — and a two-way switch would leave a non-binary traveller with no
right answer. If somebody tells you their gender, that is context for what to
*offer*, not a field to fill in.

### One of these, end to end

You ask, once and openly. Not twelve questions:

> **How would you like to be drawn?**

They answer in ordinary words:

> *"Dark skin, black hair in braids, and I'd rather be in a skirt than
> trousers. Purple, if that's an option."*

That is five of the twelve fields. Map it, and leave the other seven alone:

\`\`\`json
{ "skin": "deep", "hair": "black", "hairStyle": "braids",
  "outfit": "skirt", "pants": "plum", "shirt": "coral" }
\`\`\`

\`shirt\` is there because a skirt needs a top and they did not say — so it is a
**default you have to declare**, which is what the next step is for. Draw it
and hand over the URL:

\`\`\`http
GET ${site.url}/api/v1/${example}/travellers/preview?figure={"skin":"deep","hair":"black","hairStyle":"braids","outfit":"skirt","pants":"plum","shirt":"coral"}
\`\`\`

Then read back **both halves** — what they chose, and what they did not:

    skin: deep            ← you said
    hair: black           ← you said
    hairStyle: braids     ← you said
    outfit: skirt         ← you said
    pants: plum           ← you said
    shirt: coral            default — you didn't say, shall I change it?
    eyes: brown             default
    build: average          default
    age: adult              default

A silent default reads as a choice, and that list is the only thing stopping
it. On yes, and not before:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…

{ "id": "kerala-2027", "title": "Kerala", "start": "2027-02-01", "end": "2027-02-20",
  "travellers": [
    { "for": "ana@example.test", "skin": "deep", "hair": "black",
      "hairStyle": "braids", "outfit": "skirt", "pants": "plum", "shirt": "coral" }
  ] }
\`\`\`

A trip that already exists takes the same block written into its \`trip.md\`;
the journal's \`config.json\` takes it too, as the party for any trip that does
not say for itself.

**Every field a day takes, on one line each.** The sentences below say what to
ask and why; this is the list to check your body against before you send it,
and it is generated from the same schema \`/openapi.json\` publishes, so it
cannot fall behind. A name that is not on this list is refused rather than
dropped — the refusal will name the field you probably meant.

| Field | | What it is |
| --- | --- | --- |
${dayFieldRows()}

**Nothing is required beyond \`title\`, \`date\` and \`content\`** — but a trip keeps
track of some things, and a day that says nothing about one of them is refused
with \`422 incomplete_day\`. There are always two honest answers: send the value,
or **decline it** — \`"costs": false\`, \`"coordinates": false\`, \`"photos": false\`,
each meaning *there was none of this on this day* — **or \`"unknown"\`**, meaning
*there was some and nobody has it*. Ask the person which.

**The second and the third are different things to say about somebody's day,
and this journal keeps whichever you write.** \`false\` becomes
\`without: [costs]\` and \`"unknown"\` becomes \`unrecorded: [costs]\`, so a
reader years from now can tell *there was none* from *nobody wrote it down*
from *nobody asked*. Cash somebody paid and cannot remember is the third
answer. A day marked unrecorded still goes up, and the costs page counts it as
a zero and says so, rather than quietly reporting a total that is too low.

Never invent a figure, and never reach for a decline to get past a refusal.

${scriptIntro(dayQuestions().length)}

| Ask | Because |
| --- | --- |
${dayQuestions().map((q) => `| ${q.ask} | ${q.because} |`).join("\n")}

${wrap(PHOTOS_SECOND_CALL).join("\n")}

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days
Authorization: Bearer fs_agent_…
Content-Type: application/json

${PERFECT_DAY_EXAMPLE.join("\n")}
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "draft",
 "note": "Created as a draft. Read it back to them, then publish it when they say so."}
\`\`\`

**Every field a day can carry.** \`title\`, \`date\` and \`content\` are required;
everything else is optional, and an omitted field is better than an invented
one. The full schema, with the shape of each nested item, is in
\`${site.url}/openapi.json\` under \`components.schemas.Draft\`.

| | |
| --- | --- |
| \`time\` | \`"16:45"\`, local to where the day happened. Orders several days sharing a date. |
| \`location\`, \`country\` | The country's name, not its code. |
| \`lat\`, \`lng\` | Decimal degrees, as numbers and not strings — \`15.8801\`, never \`"15.8801"\` and never \`15° 52' 48" N\`. **A pair or nothing**: half a coordinate is refused, since it is not a place. \`lat\` is -90 to 90, \`lng\` is -180 to 180; getting them the wrong way round puts the day in the sea, so check that the smaller-ranged number is the one in \`lat\`. Four decimal places is about eleven metres and is plenty — this marks where the day happened, not where a photograph was taken. Do not geocode and write in one breath: propose what you looked up, and let them confirm it. |
| \`tags\` | Lowercase letters, digits and single hyphens. |
| \`costs\` | What the day cost, one entry per thing rather than one total: \`[{"label": "Coffee", "amount": 4.5, "currency": "EUR", "category": "food"}]\`. \`label\` and \`amount\` are required, and the amount must be greater than zero — a zero or negative one is refused rather than stored and silently dropped when the page renders. \`currency\` is the one the money was actually spent in, as an ISO-4217 code (\`VND\`, not \`₫\`); no \`currency\` means the journal's base currency, so leave it out only when that is true. Nothing is converted on the way in — see below. \`category\` is one of ${COST_CATEGORIES.join(", ")}; anything else is refused by name. |
| \`transportMode\`, \`transportFrom\`, \`transportTo\` | How this day was reached, on the day it was reached — \`{"transportMode": "car", "transportFrom": "Susten Pass", "transportTo": "Grimsel Pass"}\`. \`transportMode\` is what makes the leg exist: without it there is no arrival scene between the day before and this one, and no icon on the map, whatever the other two say. One of ${TRANSPORT_MODES.join(", ")}, and only these — an unlisted mode is refused rather than shown. \`transportFrom\` and \`transportTo\` are free text and are printed exactly as sent (\`Susten Pass → Grimsel Pass\`), so write the places the way the person says them rather than as coordinates or airport codes; they are not geocoded, and \`lat\`/\`lng\` remain what puts the day on the map. Leave the whole group out on a day nobody travelled — a rest day with a mode on it draws a leg from a place to itself. |
| \`travelScene\` | How the arrival scene between the previous day and this one plays: ${TRAVEL_SCENE_VARIANTS.join(", ")} — absent plays the default, timed to the distance covered. \`skip\` leaves the leg out of the story pager entirely, for a leg a reader has already seen many times over. Anything else is written as sent and read back as the default rather than refused. |
| \`weather\` | \`true\` asks this server to look up what the weather actually was — from the Open-Meteo archive, at this day's \`lat\`/\`lng\` on its \`date\`. **It is the only way weather gets onto a day, and you must not write one from what you believe.** A day with no coordinates gets nothing rather than a guess, and a day the archive has no answer for yet is filled in later rather than left wrong. Needs the \`weather\` capability: with it off this call is refused — \`400 weather_disabled\` — and nothing is written, rather than answered \`200\` for a lookup that will never happen. \`/api/health\` says whether it is on. |
| \`weatherData\` | A reading somebody actually took, for when you have one the archive does not. Accepted only with \`source\` (where it came from, in a few words) and \`recordedAt\` (an ISO instant), plus at least one of \`tempMin\`, \`tempMax\`, \`code\` (WMO), \`precipitation\` (mm), \`windMax\` (km/h). \`open-meteo\` is refused as a source — that name means this server measured it. The provenance is not bureaucracy: it is what lets a reader tell a measurement from something that was made up, which is the only reason weather is allowed here at all. |
| \`test\` | \`true\` when this day did not happen. See **The one rule**. |
| \`idempotency_key\` | Names this one write — see below. |

There is no \`gallery\` field and no \`status\` field — photographs are attached
separately, above, and what this writes is always a draft. The one part of a
photograph that is yours to write is its \`caption\`, and that travels with the
files or arrives later as \`captions\` on a \`PATCH\`; see **Photographs and
video**.

**Money is stored as it was spent, and converted only when it is read.** A
day's \`costs\` keep their own currencies on disk; the trip's \`rates:\` block
(\`{"THB": 0.0245}\` reads "1 THB = 0.0245 of the journal's base currency") is
what turns them into one number on the costs page. A currency that block has
no entry for is reported unconverted rather than counted at the wrong rate, so
a trip spending in a currency it does not list wants a rate added to
\`trip.md\` — not amounts converted by hand on the way in, which would record a
figure nobody spent. This is per-day spending; the trip's overall budget is a
different door (**The trip's budget**, below), and neither writes the other.

**The slug comes from the title, and no two days in a trip may share one.** A
slug is a day's address inside its trip, so a second day holding one could
never be served — the write is refused with \`409\` naming the day that already
has it, rather than accepted and lost. Titles collide more easily than they
look: punctuation and accents are folded, so \`Đà Lạt\` and \`Ðà Lạt\` are both
\`da-lat\`. ${TITLE_COLLISION_EXAMPLE}

**\`idempotency_key\` works here.** Send one on every write.
The same key with the same body replays the first answer — \`200\` with
\`"replayed": true\`, and nothing written twice. The same key with a *different*
body is refused with \`409\` and nothing is written, because answering your new
day with the old day's result and reporting success is a failure you could not
notice. **A new key for every day**: it names one write, not your session.

**\`409\` otherwise means an entry already exists for that date and title.** You
are probably retrying. Do not work around it by changing the title — ask.

**\`400\` with \`"error": "invalid_entry"\` carries a \`problems\` list**, one
entry per thing wrong, each naming the field, what arrived and what was
expected. Every problem is reported at once, so fix them together rather than
resubmitting for each:

\`\`\`json
{"error": "invalid_entry", "problems": [
  {"field": "date", "got": "\"26-08-2026\"", "expected": "a real calendar date, as YYYY-MM-DD"},
  {"field": "costs[1].amount", "got": "\"twelve\"", "expected": "a number"}
]}
\`\`\`

**\`422\` with \`"error": "incomplete_day"\` is a different thing entirely**, and
it is the one refusal here that is not about your request being malformed. A
trip says what it keeps track of — money, coordinates, photographs, all three
unless the owner has turned one off — and a day that says nothing about one of
them is not written:

\`\`\`json
{"error": "incomplete_day", "missing": [
  {"field": "costs",
   "why": "This trip keeps track of what it costs, and this day says nothing about it.",
   "send": "costs: [{\"label\": \"Dinner\", \"amount\": 42, \"currency\": \"EUR\"}] …",
   "decline": "\"costs\": false — nothing was spent on this day, or nothing worth recording"}
]}
\`\`\`

**There are two ways past it and they are equal.** Send the thing, or say in
the call that the day does not have it — \`"costs": false\`,
\`"coordinates": false\`, \`"photos": false\`. What there is not is a third way,
and the one thing that must not happen is a value invented to satisfy the
gate: a plausible cost is worse than no cost, and this refusal exists because
an agent once wrote fourteen days and left the money on its own laptop without
noticing.

**The decline is a statement about the day, not a flag on the request.** It is
written into the file as \`without: [costs]\`, so a reader a year later can
tell "nothing was spent" from "nobody asked". Which means the honest move,
when you have not asked, is to go and ask — the person is the only source for
what a day cost and where it was.

\`GET .../trips/<trip-id>/tracks\` says what a trip is asking for, and
\`PATCH\` the same URL turns a row off for good — \`{"tracks": {"costs": false}}\`
when this journey is not keeping track of money. That is the owner's decision
and belongs to the trip; it is not a way to quieten one awkward call.

**Photographs are checked when you publish, not when you write** — a day
cannot carry a picture at \`POST\`, since media is its own call. So the same
\`422\` can come back from \`publish\`, and \`{"photos": false}\` in that call is
what says this day has none.

### Editing a day

A wrong date, a misspelled place, a coordinate that was missing — correcting
a day is the ordinary case, not the exception, and it is a different call from
writing one in the first place.

\`\`\`http
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>/days/lanterns-of-hoi-an
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"lat": 15.8801, "lng": 108.338}
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "draft",
 "changed": ["lat", "lng"],
 "note": "Still a draft — not on the site. This call cannot publish it; ..."}
\`\`\`

**Send only what is changing.** Every other field — and the file's own
formatting — is left exactly as it was; this is a textual splice, the same
one \`publish\` uses to remove its one line, not a rewrite of the whole file.
It takes the same fields as \`POST .../days\` — see the table above — plus
\`content\`, which replaces the entry's whole body.

**\`status\` is not among them, and cannot be.** This call moves nothing
between draft and published, whatever is in the body — sending \`"status"\` is
refused outright, named in the response, with nothing written. **\`status\` in
the reply is always the truth, not an intention**: a draft you edit is still a
draft, and a **published** day you edit stays published and visible to
whoever has already read it — editing one changes what its readers see, so
treat it the way you would treat writing it in the first place. The only call
that moves a day between draft and published is \`.../publish\`, above.

Same authority as writing the day: whoever may \`POST\` a day into this trip
may \`PATCH\` one, trip-scoped tokens included. Deciding whether it goes on
the site — or comes back off — stays the owner's, through \`publish\` and
\`DELETE\`.

### Publishing, when they say so

One call, and the day is on the site. This is ordinary work: the person told
you what they wanted, you wrote it, they read it back, they said yes.

**The asking is the whole of the safeguard.** Do not call this because the day
reads well to you, and do not batch it into a question nobody can answer
properly: one day, one question, one answer.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/publish
Authorization: Bearer fs_agent_…
Content-Type: application/json

{}
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "published",
 "url": "${site.url}/${example}/day/lanterns-of-hoi-an"}
\`\`\`

**Give them the URL.** It is the thing they actually wanted.

**And read out \`note\`, which says who can now read the day.** That answer
belongs to the trip and not to the publish: on a public trip it is the feed,
the search index and anybody with the link; on a \`guest\` trip it is the people
the owner has approved into this journal; on a \`private\` trip it is the people
on the trip. Publishing widens nothing — do not turn the note into "it is
live", which is the sentence that makes an owner take down a closed trip
nobody could read.

**And then ask about telling people.** Publishing puts the day on the site and
announces it to nobody, so where this journal can send, the reply carries a
\`notify\` block — the channels it can use, the URL for each, and the question
to put:

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "published",
 "url": "${site.url}/${example}/day/lanterns-of-hoi-an",
 "notify": {
   "channels": [{"channel": "mail", "url": "${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/send-mail"},
                {"channel": "whatsapp", "url": "${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/send-whatsapp"}],
   "ask": "Nobody has been told this day is up. …"}}
\`\`\`

It is a prompt to ask, never a licence to send: put the question to them in
words and POST only the channel they name. It is absent when you already asked
for a channel in the publish call, when this journal sends on neither, and for
a \`test: true\` day, which sends nothing whatever anybody asks for.

Three things worth knowing:

- **Only the journal's owner can publish.** A token scoped to one trip writes
  days into it and cannot put them on the site. Being on the trip is not the
  same as deciding what the journal says.
- **Publishing twice is refused**, rather than answered with a cheerful \`200\`.
  A day that was already up went up at some point you know nothing about, and
  reporting that as your own work would be false.
- **It does not really come back.** Taking a day down removes it from the
  journal, the feed and the search index — not from the people who have already
  read it.

### Telling people, when they say so too

Publishing puts a day on the site; it does not tell anybody it is there.
Nobody hears about a new day until the next scheduled digest, unless you ask
for a letter now — B345.

**On publish**, add \`"send_mail": true\`. Its absence means no letter, and
that default does not change: publishing fifteen days must not mail fifteen
letters to everybody the owner knows, so ask about this the same way you ask
about publishing itself.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/publish
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"send_mail": true}
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "published",
 "url": "${site.url}/${example}/day/lanterns-of-hoi-an",
 "mail": {"attempted": true, "resend": false, "sent": 6, "failed": 0}}
\`\`\`

**The value must be the JSON boolean \`true\`, not a string or a number.**
\`"send_mail": "true"\` and \`"send_mail": 1\` are both read as no — the check
is strict on purpose, so nothing sent by mistake ever reads as a yes — but
that case is reported rather than left silent: the response carries
\`flagsIgnored\` and a short message naming which key was ignored.

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "published",
 "url": "${site.url}/${example}/day/lanterns-of-hoi-an",
 "flagsIgnored": ["send_mail"],
 "flagsIgnoredMessage": "send_mail must be boolean \`true\` to send, not a string or a number — it was ignored and nothing was sent for it."}
\`\`\`

Leaving the key out entirely is unaffected and stays silent — that is the
honest "did not ask", not a mistake.

**Afterwards**, for a day already on the site — sent it the first time and it
is worth trying again, or nobody asked for it at publish and now they have:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/send-mail
Authorization: Bearer fs_agent_…
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "attempted": true, "resend": true,
 "sent": 6, "failed": 0}
\`\`\`

### The same day, on WhatsApp

If this instance has WhatsApp switched on, the identical pair exists for it —
\`"send_whatsapp": true\` on publish, and
\`POST .../days/<slug>/send-whatsapp\` afterwards — with the identical
default: absent means nothing is sent. Both flags may be given at once.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>/publish

{"send_mail": true, "send_whatsapp": true}
\`\`\`

Three things differ from the letter, and they are worth knowing before you
offer it:

- **It goes to a phone.** A letter waits in an inbox; this buzzes in
  somebody's pocket, possibly at breakfast, possibly at 3am in another
  timezone. Ask more carefully than you would about mail, not less.
- **Its readers are a different set.** Only contacts who ticked the WhatsApp
  box *and* left a usable number — never everybody the digest reaches. Meta
  requires opt-in to WhatsApp specifically, so the digest's consent does not
  carry over, and neither does the phone number somebody typed in for
  postcards.
- **The words are not yours.** WhatsApp permits only a template approved by
  Meta days in advance, so what you send is three variables dropped into
  sentences somebody else already wrote. You cannot compose this message, and
  a request to "say something different this time" needs a new template and
  a day's wait.
- **The photograph reaches Meta, even for a private trip.** The template's
  image header means the day's first photograph is uploaded to Meta's servers
  before the message goes — unlike mail, which inlines the bytes so a private
  trip's picture never leaves the gate. That is true for every trip's
  visibility, closed ones included; there is no channel that skips the
  upload.

The reply is shaped like mail's, under \`whatsapp\` instead of \`mail\`, and
carries counts rather than numbers — a failure names its reason against a
masked number, never the number itself.

**Owner only, all four of them** — the same reason \`publish\` is: a token scoped
to one trip may write days into it and must not be able to reach the
journal's whole readership. Only the owner's approved, opted-in readers get one — the
letter reaches nobody a guest link or a buddy link would not already reach,
and a \`test: true\` day sends nothing at all, whatever the flag says. The
count comes back, never the addresses; a send that failed shows up as a
count and a reason, not only in a server log a person never opens (B272).

**Email to readers is free. WhatsApp may cost credits, and an empty balance
stops a publish that asks for it.** A letter costs nothing whatever the size of
the readership — B840 — so \`send_mail\` on its own is never refused for money
and never has to be checked against a balance first. Where this server charges
for sends (B366), one credit goes per WhatsApp message, counting everybody but
the owner: their own copy goes out free on both channels. The requested
channels are priced together, against one balance, **before** anything is
published: a journal that cannot cover the whole send gets **402** with
\`needed\` and \`balance\`, the day stays a draft, and nothing is sent. It is
all-or-nothing, so half a mailing list is never the outcome.

\`GET /api/v1/${example}/status\` carries \`credits.balance\` when the server
bills; read it before you publish with either flag rather than discovering an
empty account from a 402. An absent \`credits\` key means this server does not
charge, not that the account is empty.

**A 402 is a message to pass on, and you can pass a link with it.** \`POST
/api/v1/${example}/credits/purchase\` with a \`credits\` amount starts a purchase and
answers with \`paymentUrl\` — an absolute link to a page showing the amount, the
credits and a button. **It buys nothing.** No balance moves, no card is
charged, and nothing you hold can change that: the money happens on that page,
in a browser, at a payment provider, and the credits land when the provider
tells this server they did. Owner-only, like every other credits call.

So the honest report is: *"that send needs N credits and the balance is M —
here is a link to buy more, open it when you like."* Hand over the
URL. Do not say credits were added, and do not press on and retry the send.

**Name the amount, never the price.** \`credits\` is a whole number from
${MIN_CREDITS} to ${MAX_CREDITS}, in steps of ${CREDIT_STEP}; this server works
out what it costs and answers with \`priceRappen\` and the \`discount\` it
applied. Buying more at once costs less per credit — ${formatChf(BASE_RAPPEN_PER_CREDIT)}
each up to ${DISCOUNT_FROM}, falling to about ${formatChf(Math.round(priceRappen(MAX_CREDITS) / MAX_CREDITS))} at ${MAX_CREDITS}.
An amount out of range, not whole, or off the step is refused with **400**
rather than rounded to one that is.

Publishing without either flag is never charged and never refused this way, so
a day can always go on the site — it is only the announcement that waits.

**Neither resend is idempotent, on purpose.** \`/send-mail\` and
\`/send-whatsapp\` reach everybody again, every time — the owner asking twice is the only guard there is, so ask
in words before you call it a second time, the same discipline as
\`/publish\` itself.

When you have finished writing, end your report with what is waiting:
\`GET /api/v1/${example}/drafts\` lists it, and this is the call that acts on
their answer.

${wrap(PUBLISH_OFFER).join("\n")}

${wrap(GUEST_LINK_OFFER).join("\n")} See **Letting other people in**, above,
for the two links and what each does.

### Deleting, and anything that costs money

Some calls are refused the first time on purpose.

\`\`\`http
DELETE ${site.url}/api/v1/${example}/trips/<trip-id>/days
Authorization: Bearer fs_agent_…

{"slug": "lanterns-of-hoi-an"}
\`\`\`

\`\`\`json
{"error": "confirmation_required",
 "confirm": "cf_m1x2y3_…",
 "message": "This permanently deletes the draft \"lanterns-of-hoi-an\". Did the person
             actually ask you to? …"}
\`\`\`

Repeat the call with \`"confirm"\` set to that value and it goes through. The
code is bound to that exact journal, trip, day and verb, lasts five minutes,
and is signed by the server — one issued for a different day will not verify,
and you cannot make one up.

**The question in the message is the point.** If nobody asked you to delete
this, do not confirm it; say what you were about to do and ask.

A **published** day can be deleted too, and is not a harder version of the same
thing. It gets its own verb, its own code and a blunter message, because people
have already read it — anyone who followed a link to it, or who has it sitting
in their feed reader, has seen it. A code issued to tidy away an unpublished
scrap will not verify against a published day: the action is part of what is
signed. Ask a person first. Nothing here can undo it.

Either way the **photographs stay**. Deleting a day removes its entry file and
leaves its media folder alone, so the same pictures are still there to write
around if the day was deleted in error. Say that when you report what you did —
do not tell somebody their photographs are gone when they are not.

Anything that **spends money** — ordering a photobook, sending postcards —
needs the code *and* a payment the person makes themselves: the server emails
them a link, and nothing reaches a printer until that is paid. There is no
call here that puts a charge on somebody's card.

**A full journal is the owner's to fix, not yours.** When an upload is refused
for want of room, say so and stop — the owner can delete something or buy
5 GB more from their own page, and either is their decision. The call that
buys it takes the owner's own browser session and refuses a token, so it is
not one you can make on their behalf. Their journal's owner is already mailed
when it gets close to full.

### Deleting a trip, or the whole journal

\`\`\`http
DELETE ${site.url}/api/v1/${example}/trips/<trip-id>
DELETE ${site.url}/api/v1/${example}
Authorization: Bearer fs_agent_…
\`\`\`

\`\`\`json
{"ok": true, "deleted": false, "status": "confirmation_sent",
 "mailedTo": "them@example.com",
 "note": "NOTHING HAS BEEN DELETED. A mail has gone to the address that owns this
          journal with a link to a page that asks once more and has a button on it…"}
\`\`\`

**A \`202\` here is not success, and reporting it as one is the failure this is
built to avoid.** Nothing has been deleted. The server has mailed the address
that owns the journal a single-use link, valid for an hour, to a page that
names what would go and has a button on it. Only that button deletes.

**You cannot finish this, and that is deliberate.** The confirmation code in
the section above goes to *you*, which is right for a draft day and wrong for
somebody's photographs and every word they wrote: an agent that misread "get
rid of that test entry" could satisfy its own confirmation. So the second step
happens in a mailbox you cannot open. Do not ask for the link, do not offer to
follow it, and do not treat not receiving it as something to work around.

What to say: *a mail is on its way to \`mailedTo\`, and the journal is still
there until they open it and press the button.* Then stop.

Two things worth telling them before they do:

- **A trip takes its photographs with it.** Deleting a *day* leaves its media
  on disk; deleting a *trip* does not. That difference surprises people.
- **A deleted journal's name is never given out again**, so the address stops
  working for good rather than becoming somebody else's. Old links answer
  \`410 Gone\`.

The page offers them a complete copy first — private trips and unpublished
drafts included, not just the public export — because leaving with your data is
the half of leaving that a delete button on its own does not give you.

Only the journal's **owner** may ask. A token scoped to one trip can write days
into that trip and cannot delete it, or the journal around it; being on
somebody's journey is not authority to end it.

### The trip's budget

A trip's costs page (\`/${example}/trips/<trip-id>/costs\`) is presence-driven:
it appears the moment there is a \`costs.md\` **or** any day carrying its own
\`costs:\` block, and only goes away once both are gone (B332). Before B295 the
only way to write a \`costs.md\` was by hand, over SSH or with the
\`add-a-trip\` skill on a local checkout — this is the door.

\`\`\`http
PUT ${site.url}/api/v1/${example}/trips/<trip-id>/costs
Authorization: Bearer fs_agent_…
Content-Type: application/json

{
  "budget": {"total": 12000, "days": 45, "currency": "CHF"},
  "costs": [{"label": "Rail pass", "amount": 420, "category": "preparation"}],
  "body": "The rail pass is the decision everything else follows from."
}
\`\`\`

\`\`\`json
{"ok": true, "trip": "${example}/<trip-id>",
 "note": "costs.md now exists (or was replaced) for this trip. GET this same URL..."}
\`\`\`

\`total\` is the whole trip's planned spend, not a daily figure, and \`days\`
is how many days it is meant to cover — the per-day allowance the page shows
is the one divided by the other, so a total for a month and a \`days\` of 45
reads as a budget nobody set. \`currency\` is the budget's own, three letters,
and omitting it means the journal's base currency. Preparation \`costs\` beside
it are the money spent *before* leaving — the rail pass, the visa, the boots
— and each takes the same fields as a day's, so an amount must be greater than
zero and a category must be one of ${COST_CATEGORIES.join(", ")}. What was
spent *on* the trip belongs on its days, not here.

**\`budget\` is required, and both \`total\` and \`days\` must be positive.** A
zero or missing total is refused here, with a \`problems\` entry naming
\`budget.total\` — not written and read back as no budget at all, which is what
\`lib/costFormat.ts\`'s \`parseBudget\` does silently when the page renders
(B263). An unknown category or an unrecognisable currency code is refused the
same way, by name, on either field.

\`\`\`json
{"error": "invalid_costs", "problems": [
  {"field": "budget.total", "got": "0", "expected": "a positive number..."},
  {"field": "costs[0].category", "got": "\\"shenanigans\\"", "expected": "one of preparation, flights, ..."}
]}
\`\`\`

**\`PATCH\` changes part of it without resending everything**, textually — the
same discipline as editing a day (B266): a field this omits, and the file's
own formatting, comments and key order, survive untouched. This may well be a
\`costs.md\` the owner wrote themselves.

\`\`\`http
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>/costs
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"budget": {"total": 13500, "days": 45, "currency": "CHF"}}
\`\`\`

\`budget\`, \`costs\` and \`body\` each replace their own block wholesale when
sent — \`"budget": null\` clears the budget alone and leaves the rest of the
file; \`"costs": []\` clears the preparation-costs list the same way. Neither
removes the file, and PATCH refuses to run at all against a trip with no
\`costs.md\` yet — PUT to the same URL first.

\`\`\`http
GET ${site.url}/api/v1/${example}/trips/<trip-id>/costs
DELETE ${site.url}/api/v1/${example}/trips/<trip-id>/costs
Authorization: Bearer fs_agent_…
\`\`\`

\`GET\` reads the budget and the preparation costs back as stored, plus the
journal's base currency, so you can confirm what you wrote before telling
somebody it is there — \`"exists": false\` means there is no \`costs.md\` yet,
which is not an error. \`DELETE\` removes the file entirely, which takes the
budget away but **not necessarily the costs page** — a day still carrying its
own \`costs:\` block keeps the page standing (B332), so \`"costsPageGone"\` in
the response says whether it actually did rather than leaving that to be
inferred. Calling \`DELETE\` again once the file is gone answers \`404\`.

**Same authority as writing a day.** Whoever may \`POST\` a day into this trip
may read, write, amend or delete its budget too, trip-scoped tokens included —
a budget is trip content, and the people on a trip are the people who spent
the money. Per-day spending is a different field entirely: \`costs\` on
\`POST .../days\`, above, which this door does not touch.

### What the trip actually cost, from a bank statement

A statement is the other half of a budget: the budget is what somebody meant to
spend, and this is what left their account.

\`\`\`http
POST ${site.url}/api/v1/${example}/import
Content-Type: application/json

{"kind": "costs", "inbox": "<id>", "from": "<trip start>", "to": "<trip end>"}
\`\`\`

Stage the statement in the inbox first, exactly as for a location history — a
\`.csv\` lands in \`files/\`. The date window is worth sending: a statement
covers the trip *and* the fortnight either side of it, and the totals and rates
that come back describe whatever window you asked for.

**It writes nothing.** What comes back is the spending grouped by day, the
merchants biggest-first, the money that was not spending (transfers, money
coming in) counted rather than hidden, and — the number nobody can look up —
what a unit of each foreign currency **actually cost**, taken from the money
the bank moved rather than from any published table.

Then the part that is not yours:

**Agree the categories, merchant by merchant.** The list comes back sorted
biggest first because one decision about a merchant covers every payment to it.
A statement says what was paid, never what it was for; \`other\` is a real
answer and a good one, and a plausible category you chose yourself is exactly
the kind of fiction nobody catches later. Ask.

**Then ask which rows were the trip's at all.** The rent is in there. So is the
phone bill.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/costs/import
Content-Type: application/json

{"rows": [
  {"date": "2026-06-22", "label": "Padaria Central", "amount": 11.65,
   "currency": "CHF", "category": "food"}
]}
\`\`\`

That **adds** to each day — costs somebody wrote by hand stay, and sending the
same rows twice writes them twice. A date whose day nobody has written yet
comes back in \`orphaned\` and nothing is recorded for it; the cost is never
moved to a neighbouring day.

The rates the import worked out are not written either. If the trip has none,
they are the numbers to send to the rates door below.

### The trip's exchange rates

\`createTrip\` could only ever write \`rates:\` once, at the moment a trip is
made — B352 opened a door to amend it afterwards, because a costs page with an
unrated currency had nowhere else to send an owner on a hosted instance: "add
the missing rates to the trip's trip.md" is advice with nowhere to go when
nobody has a shell.

\`\`\`http
GET ${site.url}/api/v1/${example}/trips/<trip-id>/rates
Authorization: Bearer fs_agent_…
\`\`\`

\`\`\`json
{"trip": "${example}/<trip-id>", "rates": {"THB": 0.0245}}
\`\`\`

\`\`\`http
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>/rates
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"rates": {"EUR": 0.94}}
\`\`\`

**This merges, it does not replace.** Naming one currency fills in or corrects
that one and leaves every other rate already on the trip untouched — send the
one THB rate a trip is missing, not the whole table. Costs already recorded in
a currency you just add convert the next time the costs page, or any total
drawn from it, is read; nothing needs re-entering. The same validation
\`createTrip\` uses runs here too, so a rate rejected on this call would have
been rejected at creation, and one written here reads back exactly the way one
written at creation would.

**Owner only**, like \`rates\` at creation — a trip-scoped token is refused with
\`out_of_scope\`, because a rate table is metadata about the trip, the same
shelf \`visibility\` and \`people\` sit on, and not content a traveller logs.
That is different from the trip's budget, above, which anyone on the trip may
write.

### What the trip is called, when it ran, and its cover

Four fields nothing could write until B622 — \`title\`, \`tagline\`, \`start\`
and \`end\` — plus \`cover\`, which B245 added to the same door once a trip has
photographs to choose from.

\`\`\`http
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"title": "Algarve 2026", "end": "2026-04-19"}
\`\`\`

Send only what changes. A \`title\` cannot be cleared — a \`trip.md\` without
one does not load at all — while an emptied \`tagline\` or a \`cover\` sent as
\`null\`/\`""\` removes the key rather than storing an empty one. Dates are
\`YYYY-MM-DD\`, and \`end\` may not come before \`start\`; that is checked
against the *result*, so either date may arrive on its own. \`cover\` must name
a \`src\` this trip's own gallery already has — read it from
\`GET .../trips/<trip-id>/media\` — since a value naming a photo the trip does
not carry would render as a broken image on the trips index and the sharing
card, so it is refused (\`invalid_cover\`) rather than written.

**Only the lines you name are rewritten.** The prose under the frontmatter, the
order of the keys, and every key this call has never heard of come back byte for
byte — so this is safe on a \`trip.md\` somebody wrote by hand, and a fixed typo
in a title does not turn up as a diff touching three other fields.

**Owner only**, like \`visibility\` and \`rates\`: a trip-scoped token is
refused with \`out_of_scope\`. Being on the bus is not the same as saying what
the journey is called.

### Who may read the trip

\`createTrip\` could also only ever write \`visibility:\` once — B396 opened
the same kind of door \`rates\` above got from B352, because "set a trip's
visibility to guest" was, until this, advice with nowhere to go once a trip
already existed.

\`\`\`http
GET ${site.url}/api/v1/${example}/trips/<trip-id>/visibility
Authorization: Bearer fs_agent_…
\`\`\`

\`\`\`json
{"trip": "${example}/<trip-id>", "visibility": "private", "listed": false}
\`\`\`

\`\`\`http
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>/visibility
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"visibility": "guest"}
\`\`\`

Send \`visibility\`, \`listed\`, or both — only what changes. \`visibility\` is
one of \`private\` (the people who were there, and the owner), \`public\`
(everyone) or \`guest\` (everyone the owner has approved into the journal, and
the people who were there); an unrecognised value is refused rather than
written, the same rule the file's own reader already follows so a typo can
never end up read as \`public\`. \`listed\` only ever narrows: \`true\` is
refused on a trip whose visibility does not already advertise it — only a
\`public\` trip is — and omitting it when visibility narrows away from
\`public\` drops a stale \`listed: true\` rather than leaving it sitting inert
in the file.

**Widening is said out loud.** Moving from \`private\` or \`guest\` towards
\`public\`, or from \`private\` to \`guest\`, exposes every day already
published on this trip to a wider audience the instant this call returns — say
that plainly before reporting it done. Narrowing needs no such warning: it can
only take readers away, never add one.

**Owner only**, like \`visibility\` at creation and for the same reason
\`rates\` is above — a trip-scoped token is refused with \`out_of_scope\`.
Somebody on the trip may write days into it; deciding who else may read the
whole journey is not that authority.

### Who was on the trip, and how they are drawn

The last two fields \`createTrip\` could write once and nothing could write
again — B524, the same door \`rates\` and \`visibility\` got before it. "My
partner was on this trip too", arriving after the trip exists, is the ordinary
case, and until this the only answer was to delete the trip and rewrite every
day and every photograph in it.

\`\`\`http
GET ${site.url}/api/v1/${example}/trips/<trip-id>/people
PATCH ${site.url}/api/v1/${example}/trips/<trip-id>/travellers
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"travellers": [{"skin": "medium", "hair": "black", "hairStyle": "coils"}]}
\`\`\`

**These replace, they do not merge** — the opposite of \`rates\` above, and the
difference is worth knowing before you send one. A rate table is a set of
independent facts; a party is a list whose membership is the point, and a call
naming one person would have to guess whether the others were being kept.
So: read it back, change the list, send the whole thing. \`[]\` clears it.

\`people\` **is write access**, and the response says what the call did in
those terms rather than answering \`ok\`: who may now write to every day of the
trip, and who may not. Removing somebody does not revoke a token they already
hold — it expires on its own, and revoking it is a separate act. What you see
here is \`trip.md\`'s own list, which is also the byline; anybody the owner
approved through a buddy link may write too and is not in it.

**Owner only**, both of them. \`travellers\` is cosmetic and could defensibly
be looser; it is held to the same line so there is one answer to who may edit a
trip's own fields rather than two.

### When the pictures arrive before the days: the inbox

\`\`\`http
POST ${site.url}/api/v1/${example}/inbox
Authorization: Bearer fs_agent_…
Content-Type: multipart/form-data

files=@DSC_4471.HEIC
files=@DSC_4472.HEIC
meta={"description": "The lanterns going up on the bridge", "lat": 15.88, "lon": 108.33}
meta={}
\`\`\`

Every other door here makes a file name the day it belongs to. This one does
not, and that is the whole point: somebody comes back from a week away with two
hundred photographs and none of the days are written yet. Put them here, then
write the days, then file them.

\`\`\`http
GET ${site.url}/api/v1/${example}/inbox
\`\`\`

lists everything staged, by kind — \`media\` for pictures and clips, \`files\`
for documents, \`photobook\` and \`postcards\` for artwork — with whatever was
said about each one. **Ask for this before you write days for a trip somebody
has just got back from.** The pictures are often already there, and a day
written without them is a day somebody has to come back to.

Filing one is the media call below, with \`inbox\` instead of \`files\`:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Content-Type: application/json

{"day": "lanterns-of-hoi-an", "inbox": ["a3f1c2b4d5e6-dsc-4471.heic"]}
\`\`\`

That **moves** the file: it goes into the day and leaves the inbox, so the
bucket empties as the trip gets written and nothing is stored twice.

**Everything on \`meta\` is optional, and every field of it is what you were
told.** Not what the photograph looks like to you. A staged file with no
description is completely normal; an invented one is somebody's memory
replaced with your guess, and nobody downstream can tell which it was.

**Which day a picture belongs to is not yours to decide either.** The inbox
makes it *possible* to sort two hundred files into days; it does not make it
your call. Ask.

**The same file twice costs nothing.** A staged file is named by a hash of its
own bytes, so re-sending one you already sent answers with the same id and
\`duplicate: true\` rather than a second copy. Retry a half-finished batch
freely.

### Where somebody actually went

A trip's map knows the days and the photographs, and joins them with straight
lines. If the owner has a location history — Google Maps Timeline, a Takeout,
a GPX from a watch — the map can show the road actually driven instead.

Two calls, because they are two decisions.

\`\`\`http
GET ${site.url}/api/v1/${example}/import
\`\`\`

Answers with the kinds of data this instance reads and the formats it knows.
A **kind** is what the data *is* — \`gps\` for a location history, \`costs\`
for a bank statement — and a **format** is who wrote it (\`google-timeline\`,
\`google-records\`, \`gpx\`, \`fixes\`, \`revolut\`).

**Say the kind.** An absent one is refused rather than guessed at: reading
somebody's bank statement as positions, or their location history as money, is
not a mistake to make quietly.

Stage the export in the inbox as above — it is a \`.json\` or a \`.gpx\`, so it
lands in \`files/\` — and then:

\`\`\`http
POST ${site.url}/api/v1/${example}/import
Content-Type: application/json

{"kind": "gps", "inbox": "<id>"}
\`\`\`

Leave \`format\` out and the file is recognised from its own contents. Add
\`"dryRun": true\` to see what would be read without writing anything — that is
also how somebody tests an importer they wrote, because it runs the same
contract check the format's own schema exports and answers in words: *seconds
where milliseconds were meant*, *coordinates the wrong way round*.

Nothing is drawn yet. The second call says which trip may show it:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/track
\`\`\`

That clips the history to the trip's dates, cuts out the owner's private
zones, leaves a gap of more than two hours as a gap — a flight is a hole in
the data, not a line across a continent — and writes the result into the trip,
where the map draws it faintly under the day markers. Run it again whenever
more history is imported.

**Read this part twice.** What you are handling is every address that person
sleeps at, every place they work, everywhere they have ever been ill.

- **Nothing gives it back to you.** There is no call that returns a position,
  and there will not be. You can cause a line to be drawn for one trip; you
  cannot read the history, and neither can anyone else.
- **The raw export stays in the inbox until somebody deletes it**, and it is
  the unthinned original. When the import has worked, say so and offer to
  \`DELETE\` it.
- **Ask about home.** If a trip started or ended at the front door, the line
  starts at the front door. The answer to the track call says how many private
  zones were applied; if it says none, ask whether there should be one before
  anything is published.
- **A trip-scoped token cannot do any of this**, even for its own trip. If you
  hold one, the person you are working for is not the person whose history
  this is.

### Photographs and video

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Authorization: Bearer fs_agent_…
Content-Type: multipart/form-data

day=lanterns-of-hoi-an
files=@DSC_4471.HEIC
files=@DSC_4472.HEIC
captions=The lanterns going up on the bridge
captions=
visibility=
visibility=private
\`\`\`

**The photographs are put into the day for you.** There is nothing to paste,
and it does not matter whether you write the day before or after sending its
pictures — only that the day exists when they arrive. The reply lists what it
attached, as a record rather than as homework:

\`\`\`json
{"ok": true, "day": "lanterns-of-hoi-an", "attached": true,
 "items": [{"src": "/${example}/media/<trip>/lanterns-of-hoi-an/01.jpg",
            "type": "image", "width": 2000, "height": 1333}],
 "kept":  [{"filename": "DSC_4471.jpg", "bytes": 4210332,
            "width": 3000, "height": 2000}]}
\`\`\`

**\`items\` is what the site serves; \`kept\` is what was stored for print.** The
dimensions differ on purpose — the served copy is resized, the original is not
touched — and \`kept\` is there so you can see that the original survived rather
than inferring it from a promise. If \`kept\` shows the same numbers you sent,
the full-resolution file is on disk.

**Nothing is read out of the file.** This route stores photographs and opens
none of their EXIF: a picture carrying GPS and a \`DateTimeOriginal\` adds no
\`lat\`, no \`lng\`, no \`location\`, no \`country\` and no \`time\` to the day. The
day keeps exactly what you wrote on it, so send those fields yourself —
\`POST .../days\` and \`PATCH .../days/<slug>\` both take them. Ingest is the one
thing here that reads a card's EXIF, and it runs on the machine the journal
lives on: **A folder of photographs, all at once**, below.

**A caption is the one part of a photograph you write.** \`captions\` runs
alongside \`files\` (or \`urls\`), one per picture and in the same order — send
an empty one, or simply fewer, for a picture nobody said anything about. More
captions than files is refused rather than shifted along, because a caption on
the wrong photograph is worse than no caption at all. It is drawn under the
picture on the day, on the tile in the trip gallery, and is the image's alt
text.

Write **what you were told**, and nothing else. Not what the picture looks like
to you, not the weather in it, not who you think is in it — a caption is read
by the family of the person who was there, and an invented one is a
misremembering presented to them as a record. An empty caption beats a
plausible one. **One line, at most ${CAPTION_MAX_CHARS} characters** — a
caption carrying a line break is refused rather than folded, and the day's
prose is where the longer version belongs.

**Correcting one later needs no re-upload:** \`PATCH .../days/<slug>\` with
\`captions\` as an object keyed by the photograph's \`src\`, exactly as you read
it back — \`{"captions": {"/${example}/media/<trip>/lanterns-of-hoi-an/01.jpg":
"The lanterns going up"}}\`. An empty string removes a caption; a \`src\` the
day does not carry is **refused**, so a typo in the one argument this field
takes cannot look like success. Nothing else in the day changes, prose and
title included, and the photographs themselves are never rewritten by that
call.

### Holding one photograph back

\`visibility\` runs alongside \`files\` the way \`captions\` does — one per
picture, in the same order, empty for the ones nobody is holding back. It is
the second and last part of a photograph you write, and it is here for the one
frame in a day that should be seen by fewer people than the rest of it: a
stranger's child, somebody's front door, a hospital room.

Two values, and they mean what the same two words mean on a trip. \`guest\` —
everybody the owner has approved into this journal, plus the people named on
the trip. \`private\` — the people named on the trip, and the owner.

**It narrows and never widens.** There is no \`public\`, and asking for one is
refused rather than quietly accepted: a label holds a photograph back from
readers the trip already lets in, and can never show one to somebody the trip
keeps out. So a \`guest\` photograph inside a \`private\` trip is still only for
the people who were there, and a picture carrying no label is already
everybody's who can open the trip. **The whole day is the trip's own
\`visibility\` to decide** — if most of a journey should be held back, that is
one answer on the trip, not thirty labels on its photographs.

A labelled photograph is absent from the day, from the gallery, and from every
payload sent to a reader below its level, and its file answers \`404\`. It is
held back rather than hidden, so there is no URL left to forward.

**Only ever what the owner asked for**, and this is less yours to judge than a
caption is: you cannot see who is in a photograph, or whether they would mind.
A picture nobody said anything about is not held back on a hunch. Ask, and
label the ones they name.

**Changing your mind needs no re-upload:** \`PATCH .../days/<slug>\` with
\`photoVisibility\`, keyed by \`src\` exactly as \`captions\` is —
\`{"photoVisibility": {"/${example}/media/<trip>/lanterns-of-hoi-an/02.jpg":
"private"}}\`. \`null\` clears a label, which is how a photograph goes back to
being seen by everyone the trip lets in. A \`src\` the day does not carry is
refused here too, because "I have marked that photograph private" followed by
nothing landing is the worst answer this field could give.

\`kept.filename\` is **advisory** — it is what the source called the file, not
what is on disk. Sending bytes, that is your own filename and correlates. From
a URL it is the last path segment, so \`…/seed/x/3000/2000\` reports
\`"2000.jpg"\`; the stored name is \`01.jpg\` either way. Correlate by position:
\`kept[n]\` is \`items[n]\` is the n-th file you sent.

\`day\` is required and must name a day that already exists in this trip. A
**published** day is allowed — the same as \`PATCH\` on the day itself — and the
reply's \`note\` says plainly that anyone who already read it can now see the
addition.

**Send the largest file you have.** Two files are written from each one you
send: a resized copy at 2000px which is what the site serves, and **the
original, untouched**, which is what a printed photobook is made from.

The served copy carries no EXIF, no XMP and no GPS — the colour profile is the
one thing kept, because dropping it makes the picture the wrong colour. That is
not the same as a file with nothing in it: it still says how large it is and
what colour space it is in, as any image must. Do not tell somebody their
photographs have been anonymised. What has been removed is where and when they
were taken and what took them. The original is never served over HTTP and never
leaves the server. If you send a 2000px export because it seemed polite, the
book is stuck with it — a full-page plate at 300 dpi wants about 2500×3500, and
there is no way to get those pixels back later.

HEIC straight off an iPhone is fine; so is anything in the table below. Send as
many files as you like in one request, up to the per-day limit.

**What the site serves is always a JPEG**, whatever you sent: a PNG, a HEIC or
a webp is re-encoded, which is why the reply names the file \`01.jpg\`. That is
right for a photograph and visibly wrong for flat colour — a screenshot, a map,
a scan or a chart picks up banding that somebody who chose PNG deliberately
will notice. The file you sent is not touched by any of it: \`kept\` reports its
bytes, and a printed photobook is made from that and not from the JPEG.

**Or give it URLs instead of bytes**, and this server downloads them — clips as
well as photographs, on the same terms as sending the bytes yourself, and with
no request-body limit in the way since the download is this server's:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"day": "lanterns-of-hoi-an", "urls": ["https://…/one.jpg", "https://…/market.mp4"]}
\`\`\`

**https only, and public hosts only.** Anything resolving to a private,
loopback or link-local address is refused — including after a redirect — so a
URL pointing at this server's own network, or at a cloud metadata endpoint,
will not be fetched. If a URL is refused you are told which one and why, and
nothing is written: fix it and send the batch again.

**The refusals say whether resending will help, so read the reason.** A single
failure discards the whole batch, so it is worth knowing which of these you
have before you tell somebody their photo host is blocked:

| The reason says | What it means |
| --- | --- |
| does not resolve to a public address | **Permanent.** That URL points somewhere it will never be allowed to point — private, loopback, link-local, or a cloud metadata address — and resending changes nothing. Deliberately the same words for every such range. |
| there is no such name | **Permanent.** The name does not exist. Check the spelling; resending a typo will not fix it. |
| the name did not resolve | **Transient.** A resolver that did not answer, which is often a moment rather than a fact. Send the batch again. |
| took longer than N seconds to answer, or to send its body | **Transient.** The host was reachable and slow. Send the batch again. |
| could not be reached | The connection failed. Not obviously either — retry once, then treat the host as the problem. |
| answered 404, is text/html not an image, is larger than N MB, too many redirects | **Permanent for that URL.** Pick another one. |

You do not need to pre-flight URLs yourself. If you do anyway, note that a
\`HEAD\` is not a reliable test — plenty of image hosts answer it with \`405\`
while serving \`GET\` perfectly well.

**What is kept from a URL is the file the remote host served.** The warning
above about sending the largest file you have applies here with nothing you can
do about it afterwards: there is no "largest file" to choose, so if the URL
points at a 2000px web export, that export *is* the original, and a printed
photobook will be made from it. When the person has the real files, send the
bytes instead.

### Holding a whole update back

\`visibility\` on the day itself is the sibling of \`visibility\` on one
photograph, above — same two words, same populations, same rule. It is for
the day that should be seen by fewer people than the rest of the trip: one
entry written for the family and a second, on the same day, for whoever the
owner has let into the journal.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"title": "The part just for us", "date": "2026-08-25",
 "content": "…", "visibility": "guest"}
\`\`\`

**It narrows and never widens.** There is no \`public\`, and asking for one is
refused rather than quietly accepted, for the same reason as the photograph's
own label: this holds an update back from readers the trip already lets in,
and can never show one to somebody the trip keeps out. A \`guest\` update
inside a \`private\` trip is still only for the people who were there.

**Unlike \`photoVisibility\`, this is writable at creation** — send it in the
same call that writes the day, because it is one field on the entry rather
than a label matched against a photograph's \`src\`. It is just as writable
later: \`PATCH .../days/<slug>\` with \`{"visibility": "guest"}\`, or
\`{"visibility": null}\` to go back to being seen by everyone the trip lets in.

A labelled update is absent from the page, the feed, the sitemap and the
search index for a reader below its level — the day simply is not there,
the way an unpublished draft is not there for a stranger — and its markdown
twin (\`/${example}/day/<slug>.md\`) answers as though no such day existed
rather than saying anything about it.

**Only ever what the owner asked for.** Whether one entry on a day, or the
whole day, should be held back is theirs to say; a day nobody said anything
about is not held back on a hunch.

### What is accepted

| | |
| --- | --- |
| images | ${IMAGE_FORMATS.join(", ")} — at most ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB, ${IMAGE_MAX_EDGE}px on the longest edge |
| video | ${videoRow()} |
| per day | at most ${MAX_ITEMS_PER_DAY} items, counting what the day already holds — a batch too big for one call is too big for one day either way, so splitting it will not help |
| per request | **at most ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB of body**, which is the limit you will actually meet |
| per journal | a storage ceiling over the whole journal folder — photobooks and all, not only photographs. \`GET /api/v1/<user>/status\` carries \`storage\`: what is used, what is allowed, what is left. Read it before a big batch; one that would go past the ceiling is refused whole and nothing is written |
| tags | lowercase letters, digits and single hyphens, up to ${TAG_MAX_LENGTH} characters |
| transport | ${TRANSPORT_MODES.join(", ")} |
| travel scene | ${TRAVEL_SCENE_VARIANTS.join(", ")} — absent plays the default |

**A batch that was refused is resumed by reading the day, not by counting.**
Every gallery item comes back with \`from\` — what you called the file when you
sent it — beside the \`src\` this server assigned it. Compare that list against
what you meant to send and upload the difference. Counting instead is how the
same photograph gets uploaded twice and another one silently never arrives.
Days written before this field existed do not carry it.

**Sending the same file twice adds it once.** A batch that fails halfway, or a
retry after a network error, can be sent again as it was: an arriving
photograph that is byte-for-byte one this day already holds is left out rather
than appended. The 201 carries \`skipped\` — what you sent, and the \`src\` of
the picture it matched — so a response with fewer \`items\` than you sent files
is telling you the day already had those exact files, not that anything was
lost. It is per day, so the same picture on two days is kept, that being a
thing people do on purpose. Clips are not compared, and a clip sent twice
lands twice.

**A photograph that merely *resembles* one already here is kept, not dropped.**
The server compares what pictures look like as well as what bytes they are, but
a resemblance is a guess and the two ways of being wrong do not cost the same:
a second tile in the gallery is deleted in ten seconds, while a photograph
discarded in silence is gone. So a likeness is stored and named in \`advice\`,
with the \`src\` of the picture it looks like — delete one of them if they
really are the same. The same photograph exported twice, at a different size or
quality, is the case this covers.

**The body limit is the one that bites, and it is not the per-file limit.**
Forty photographs may go in one call and each may be ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB, but the request
carrying them may not exceed ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB in total, so a batch of phone
originals is several calls rather than one. Sending more is answered
\`413 body_too_large\` with the cap and what arrived; nothing is written, and the
day appends across as many calls as you like. The cap sits above the largest
single file allowed above, so anything the per-file limits accept can be sent —
one large clip is simply a call of its own. \`npm run ingest\`, run on the server
against a folder, has no ceiling at all and is still the way to move a card's
worth of files at once.

These are this instance's defaults, from lib/validate/. An operator can change
any of them in the \`media\` block of \`site/config.json\`, and a journal may
narrow its own further — so if a refusal quotes a different number, that number
is the real one.

\`\`\`http
GET ${site.url}/api/v1/${example}/drafts
Authorization: Bearer fs_agent_…
\`\`\`

Everything waiting for a person — slugs, titles and dates. Useful for telling
them what is outstanding, and each entry carries \`publish\`, the call that puts
that day on the site once they say so. **That is the list to end your report
with**: what you wrote, and where they approve it.

A draft that is content nobody lived carries \`test: true\` here — including one
that inherits it from a \`test\` trip and says nothing itself. **Say so when you
read the list out.** Somebody deciding what goes on their site needs to know
which of it happened, and this is the last moment anyone asks.

To read one back in full, including a draft:

\`\`\`http
GET ${site.url}/api/v1/${example}/trips/<trip-id>/days/<slug>
Authorization: Bearer fs_agent_…
\`\`\`

The whole entry, and a \`status\` of \`draft\` or \`published\` — \`translations\`
included, in the same shape they were written in, on a journal that has any.
**Read your own work back before you tell somebody it is ready.** You are
asked not to invent anything, and this is how you check that you did not —
that the date is the one you were given, that the place is right, that nothing
has been rounded into a plausible shape, and that the translation you wrote is
the one that landed.

## A folder of photographs, all at once

There is an upload endpoint — it is documented above, under **Photographs and
video** — and for a handful of pictures it is the right one. This section is
about the other case.

If somebody hands you a whole card, and you are working **on the machine the
journal lives on**, use ingest instead:

\`\`\`
npm run ingest -- --user ${example} --trip <trip-id> <folder-of-photos>
\`\`\`

It does more than the endpoint can. It reads each file's EXIF for the time and
the place, groups what it finds into days, drops near-duplicate frames, strips
GPS from what gets published, and writes the entry frontmatter around the
result — so a folder becomes dated, located draft days rather than a pile of
attachments you then have to describe.

Over the network you have only the endpoint, which is fine: send the files and
they are added to the day. Both routes keep the original and both mark what
they create a draft.

## A journal that already exists, moving here

${wrap(MIGRATION_INTRO).join("\n")}

| In the file | In the call | |
| --- | --- | --- |
${FRONTMATTER_TO_API.map((f) => `| \`${f.key}\` | ${f.api.startsWith("—") ? f.api : `\`${f.api}\``} | ${f.note} |`).join("\n")}

The order is: the trip first, then one day end to end — write it, send its
photographs, read it back — and only then the other thirteen. A mistake found
on day one is a mistake you make once.

${wrap(MIGRATION_RECONCILE).join("\n")}

## If you need help extracting pictures or data

The photographs are on the owner's machine and so are the receipts, and this
API cannot reach them from here.
**[Fernscout Helper](${HELPER_REPO})** is a separate, MIT-licensed repository
of agent skills that runs *there* — a toolbox, not a service, and this
journal does not depend on it.

**The line between the two is worth knowing before you reach for it.** Anything
that can be done on this server is a call above, and that is where it should be
done: reading a location export is \`POST /api/v1/${example}/import\`, not a
script on somebody's laptop. The helper is for the half that genuinely cannot
run here — getting at a photo library, a local iCloud export, a PDF statement
that never leaves the machine. Once it has produced a file, the file comes back
through the calls above like anything else.

| It does | So you get |
| --- | --- |
| Exports a date range or an album out of a photo library, counting and sizing it before anything is downloaded | A folder of dated, located photographs |
| Opens a page where the owner turns off what does not belong and writes a few words per day | Their words, which is the only thing a day may be written from |
| Reads a bank statement into per-day costs, and works out the rate the money actually cost | \`costs:\` blocks and a \`rates:\` table nobody has to remember |
| Asks about the flights, the car and the hotel booked months earlier | The lines no statement covering the trip dates will ever show |

What it writes is this project's own format — \`trip.md\`, \`costs.md\`,
\`entries/YYYY-MM-DD-slug.md\` — as drafts, which you then publish through the
calls above when the owner says so. The guide is at
[${site.url}/docs/helper](${site.url}/docs/helper).

**One prompt is worth recognising.** This is the instruction the site gives an
owner to copy, and an owner who opens with it is at the very beginning — no
journal, no trip, and a laptop full of holiday photographs:

> ${ownerPromptDe(site.url)}

If that is where you are, say early that the pictures and the costs can be
extracted rather than typed, and point at the repository. It is the difference
between a journal with ten days in it and a journal with an account.

## Real postcards, in the post

A journal that has \`postcards\` and \`contacts\` switched on can put a printed
card from a day into somebody's letterbox. You compose it; **you never send
it.**

Start by asking who could receive one:

\`\`\`http
GET ${site.url}/api/v1/${example}/postcards/recipients
Authorization: Bearer fs_agent_…
\`\`\`

\`\`\`json
{"creditsEach": 15, "recipients": [
  {"contactId": "…", "name": "Marta", "city": "Lisbon", "country": "Portugal", "locale": "de"}
]}
\`\`\`

A name, a town, a country — **and never a street.** That is deliberate and it
is not an omission you should try to work around: you address a card by
\`contactId\`, and there is no way to post one to an address you were told in a
chat. Anybody on this list is an approved contact of the journal who asked for
a real postcard and left an address themselves.

Then propose the cards:

\`\`\`http
POST ${site.url}/api/v1/${example}/postcards
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"trip": "<trip-id>", "day": "<slug>", "photo": "<file in the trip's media>",
 "message": "Over the pass in the rain. Worth it.", "from": "Ana",
 "locale": "en", "recipients": ["<contactId>", "<contactId>"]}
\`\`\`

\`\`\`json
{"id": "…", "status": "draft", "recipients": 2,
 "credits": {"each": 15, "total": 30, "balance": 120},
 "url": "${site.url}/${example}/postcards/…",
 "next": "Nothing has been printed or charged. Ask the owner to open the URL and press Send."}
\`\`\`

**This charges nothing and prints nothing.** It writes a proposal and gives you
a link. On that page the owner sees the photograph, the message laid out on the
back of the card, who each one is going to, what it costs and what they have
left — and one button. The button is the only thing in this system that puts a
card in the post, and there is no API call that does it. Not one you need a
different token for: there is no route at all, because printing and posting
costs real money and happens in somebody's letterbox, and that is not a
decision to take on somebody's behalf from a sentence that sounded like a yes.

So: **hand over the URL and stop.** Do not say the cards have been sent, or are
being sent, or are on their way. Say a preview is waiting and what it will
cost. \`GET /api/v1/${example}/postcards/<id>\` tells you later whether they
actually went.

\`locale\` is what language you wrote the card in — the journal's default if you
omit it. Nothing here reads the words and decides, and nothing is translated;
it exists so the owner can see on the preview page that a card is going to
somebody who reads another language. Each recipient's own language is in the
list above, so **ask** before writing one in the wrong one.

The message is the same as everything else you write here — the author's words,
in the author's voice, about what they actually told you. A postcard is read by
one person who knows them, which makes an invented detail worse rather than
more forgivable. An order keeps for a week and then expires; make a new one
rather than asking for the old one to be revived.

## Printing a photobook

A journal with \`photobook\` switched on that has already built a book — from
the owner's own order page, not from here, since the size and the cover are
the owner's own choice and there is no API call that builds one — can put a
printed copy in somebody's letterbox the same way a postcard does: **you
propose it, you never print it.**

If the owner asks what a book could look like before opening that page: the
cover (\`${COVER_TYPES.join("\` or \`")}\`) is chosen before the size, because
not every size exists in both — softcover offers
\`${sizesFor("soft").map((s) => s.id).join("\`, \`")}\`, hardcover offers
\`${sizesFor("hard").map((s) => s.id).join("\`, \`")}\`.

Find who it could go to the same way you would for a postcard — a book is
posted to the same population, so there is no second list:

\`\`\`http
GET ${site.url}/api/v1/${example}/postcards/recipients
Authorization: Bearer fs_agent_…
\`\`\`

Then propose the print, against a book that has already finished building:

\`\`\`http
POST ${site.url}/api/v1/${example}/photobooks/<id>/print
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"contactId": "<contactId>"}
\`\`\`

\`\`\`json
{"url": "${site.url}/${example}/photobooks/…", "quotedCredits": 172, "contactId": "…",
 "next": "Nothing has been printed or charged. Ask the owner to open the URL and press the button."}
\`\`\`

**This charges nothing and prints nothing.** On that page the owner sees what
the book is, what it costs, what they have left — and one button. The button
is the only thing in this system that sends a book to the printer, and there
is no API call that does it, for the same reason there is none for a
postcard: it spends real money and lands in somebody's post. \`GET
.../photobooks/<id>\` tells you later whether it actually went.

So: **hand over the URL and stop.** Do not say the book has been printed, or
is being printed. Say a price is waiting and what it will cost.

## Errors

Every error carries an \`error\` field naming the case. **Read that, not only the
status** — two of these statuses mean two different things, and the field is
what tells them apart.

| Status | \`error\` | Meaning |
| --- | --- | --- |
| \`400\` | \`invalid_entry\` | The body has a \`problems\` list: every problem at once, each naming the field, what arrived and what was expected. |
| \`401\` | \`missing_token\`, \`invalid_token\` | No token, a wrong one, or an expired one. Ask for a new code. |
| \`403\` | \`out_of_scope\` | The token is valid but belongs to a different journal, or asks for something above a trip-scoped token's authority (the journal's rates, visibility, or a call restricted to the owner). |
| \`403\` | \`access_revoked\` | The person this token belongs to has been taken off the trip. The token stays valid for everything else it can reach, and **will not work on this trip again** — do not ask for a new code, it will be refused too. Tell the person to talk to the journal's owner. |
| \`404\` | \`unknown_trip\` | No such trip **in this journal** — or a trip-scoped token asking about a different trip in its own journal, which answers exactly as if that trip did not exist rather than \`403\`: the trip is not disclosed to a token that may not read it. Either way, **fix the id.** |
| \`404\` | \`auth_disabled\` | This server has authentication off entirely. Nothing you send will work; **stop** and tell the person. \`/api/health\` says which capabilities are on. |
| \`409\` | — | That entry already exists, or an \`idempotency_key\` was reused for a different day. |
| \`429\` | \`too_many_requests\` | Too many attempts. Wait; the response says how long. Creating a journal adds \`reason\`: \`journals_created\` is the real limit, and \`failed_attempts\` means a run of *refused* names from this address — your token is still good and the wait is not about it. |
| \`503\` | \`mail_failed\` | A code could not be sent, and none is live. Retry. |

There is no \`500\` you should ever see. If you get one, it is a fault on this
server rather than something in your request: report it and stop, rather than
retrying in a loop.

## What good looks like

- Ask before inventing. An empty field is better than a plausible fiction.
- One entry per day per place, not one per photograph.
- Write in the author's voice, in their language. Check an existing entry first.
- Tell the author what you created and that it is waiting for them.
`;
}
