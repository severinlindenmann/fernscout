import "server-only";
import { serverSite } from "../site";
// The limits are published from the constants that enforce them: a table
// typed out a second time is a table that goes stale.
import {
  IMAGE_FORMATS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  VIDEO_FORMATS,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from "../validate/media";
import { TAG_MAX_LENGTH, TRANSPORT_MODES } from "../validate/entry";
import { getDefaultUsername, getUser, listedUsernames } from "../users";
import { getTrips } from "../trips";
import { isIndexable } from "../access";
import { CODE_TTL_MINUTES } from "../auth";
// The sentences these documents share with /openapi.json, kept in one place so
// they cannot come to disagree. See the note at the top of that file.
import {
  LOCALE_LIST,
  VISIBILITY_MEANING,
  VISIBILITY_NOT_A_LOCK,
  asSentence,
  firstQuestions,
  numeral,
  wrap,
} from "./agentCopy";

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
export function instanceDocumentation(): string {
  const site = serverSite();
  const questions = firstQuestions(base());
  // Only the journals that asked to be advertised. A `private` journal is
  // reachable by anyone sent its address and appears on no list, and this
  // document is the first list anybody reads.
  const users = listedUsernames();
  const defaultUser = getDefaultUsername();

  const lines: string[] = [
    `# ${site.name}`,
    "",
    "> A travel journal whose content is markdown and photographs in a folder the",
    "> author owns. Reading happens in a browser. Writing happens through an agent",
    "> holding a token — there is no editing interface, and there will not be one.",
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
      "Two doors actually do it: a harness or client that can send an arbitrary " +
        `HTTP request with a header of its own choosing, or ${base()}/api/mcp added ` +
        "as an MCP connector — though a connector still needs its owner to hand it " +
        "a token by hand today; nothing here issues one to a connector on its own " +
        "(tracked, not fixed, as B260).",
      78,
    ),
    "",
    ...wrap(
      "If neither is open to you: say so, plainly, and stop there. There is no " +
        "upload interface to build instead, no web form, and no CMS — that absence " +
        "is the software (ROADMAP decision 24), not a gap for you to route around. " +
        'Do not offer a file the owner can "manually upload" — nothing here accepts ' +
        "one — and do not hand the job back by telling the owner to follow this " +
        "guide themselves; that is the job they asked you to do.",
      78,
    ),
    "",
    "## Before you call anything, ask",
    "",
    ...wrap(
      `${numeral(questions.length)} questions. They decide things the person lives with, ` +
        "and none of them has a default you should pick for them.",
      78,
    ),
    "",
    // Rendered from the same list the guide renders as a table — see
    // lib/api/agentCopy.ts. Two hand-written copies of this is how the two
    // documents come to disagree about what an agent should ask.
    ...questions.flatMap((q, i) => {
      const [head, ...rest] = wrap(`${i + 1}. ${asSentence(q)}`, 78);
      return [head, ...rest.map((line) => `   ${line}`)];
    }),
    "",
    // The lead-in exists to give "Neither" an antecedent: after a list whose
    // last item is about somebody's name, a bare pronoun points at nothing.
    ...wrap(
      "That third question is about listing, not access. " +
        VISIBILITY_NOT_A_LOCK.replace(/`/g, ""),
      78,
    ),
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
      "`username`, `title`, `ownerName`, `ownerNickname`, `visibility` and " +
        "`defaultLocale` are all required, and none has a default worth picking " +
        "for somebody — ask. The reply carries a write token for the journal it " +
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
        "fetch:",
      78,
    ),
    "",
    "```http",
    `POST ${base()}/api/v1/their-name/trips`,
    "Authorization: Bearer fs_agent_…",
    "Content-Type: application/json",
    "",
    '{"id": "japan-2027", "title": "Japan", "start": "2027-04-01", "end": "2027-05-15"}',
    "```",
    "",
    ...wrap(
      "`id`, `title`, `start` and `end` are all required — a trip without dates " +
        "would sit on disk and nowhere a reader could find it. Created **private** " +
        "unless you say otherwise; ask before making somebody's journey public.",
      78,
    ),
    "",
    "```http",
    `POST ${base()}/api/v1/their-name/trips/japan-2027/days`,
    "Authorization: Bearer fs_agent_…",
    "Content-Type: application/json",
    "",
    '{"title": "Lanterns of Hoi An", "date": "2026-08-26",',
    ' "content": "The whole old town hangs with lanterns."}',
    "```",
    "",
    ...wrap(
      "`title`, `date` and `content` are required; location, photographs and cost " +
        "are optional and are in the guide. This always writes a **draft**: there " +
        'is no `"status"` field you can send, and nothing here is on the site yet. ' +
        "The reply carries the `slug` the day was filed under — take it from there " +
        "rather than guessing it from the title, which is not always what a title " +
        "reduces to. Read the day back, tell the person what you wrote, and wait " +
        "for them to say yes. Only then, with that slug:",
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
    `- [MCP endpoint](${base()}/api/mcp): the same operations as MCP tools, over Streamable HTTP`,
    `- [Resource metadata](${base()}/.well-known/oauth-protected-resource): RFC 9728, for an MCP client`,
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
    "the source that produced it, rather than the rendering. The content *is*",
    "markdown, so nothing is lost in the conversion — there is no conversion.",
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
    `- [Drafts](${base()}/api/v1/${username}/drafts): everything waiting for a person to approve`,
    `- Trips: POST to [the same URL](${base()}/api/v1/${username}/trips) to create one (owner only; private by default)`,
    `- Deleting: DELETE [a trip](${base()}/api/v1/${username}/trips/<trip-id>) or [the journal](${base()}/api/v1/${username}) — owner only, and neither deletes anything: the owner is mailed a link with a button on it, so a 202 means the mail was sent`,
    `- [MCP](${base()}/api/mcp): the same operations as tools — list_trips, get_day, search_entries, list_drafts, create_day, publish_day`,
    `- [Search index](${root}/search-index.json): every public entry, for finding things`,
    `- [Feed](${root}/feed.xml): public entries as RSS`,
    `- [Export](${root}/export.zip): the whole journal as markdown and photographs`,
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

Before any call. Each decides something the person lives with, and none has a
default you should pick for them.

| Ask | Because |
| --- | --- |
${questions.map((q) => `| ${q.ask} | ${q.because} |`).join("\n")}

**Public or private** is the one nobody thinks to ask, so ask it. To say it
once more, because the table above is easy to skim past:

${wrap(VISIBILITY_MEANING.charAt(0).toUpperCase() + VISIBILITY_MEANING.slice(1)).join("\n")}

${wrap(VISIBILITY_NOT_A_LOCK).join("\n")}

So "private journal" means *unlisted*, not *locked*. If what they want is a
journal only invited people can read at all, the answer today is a journal of
private or guest trips — say that plainly rather than implying more.

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
same place and it is a different token with a different lifetime: the mailed
one is standing — no expiry, good in a week — while the one you are holding
dies in fifteen minutes. So "it is also in your email" is true about the
destination and false about this link, and an agent that says it should expect
the copy it handed over to stop working while the mailed one still opens.

Three rules about it, and they are not fussiness:

- **Give it to the person, once, immediately.** Do not repeat it later in the
  conversation, do not store it anywhere, and do not hold it back for the end
  of a long reply — besides the fifteen minutes, asking this server for an
  ordinary sign-in code for that address invalidates any relayed link that has
  not been used yet. One live code per address is the rule; the relayed link
  is swept with the rest. The welcome mail's standing link deliberately
  survives that, which is the other half of why the two are not the same link.
- **Never hand it over as "the address of your journal".** That is \`url\`.
  Somebody forwarding what they think is an address would be forwarding a
  session.
- **Do not follow it yourself.** It is single use; opening it to check it works
  spends it, and the person gets a dead link.

**All six of \`username\`, \`title\`, \`ownerName\`, \`ownerNickname\`,
\`visibility\` and \`defaultLocale\` are required**, and none of them is
guessable — a request missing any of them is refused rather than filled in on
somebody's behalf. \`ownerNickname\` is what the site calls this person in its
own voice — "Robin", not "Robin Delacroix-Mbeki" — and it is never derived
from \`ownerName\`, because taking the first word mangles any name whose given
name is not first. Ask.

**Ask even when the owner is the person in front of you.** Somebody setting up
their own journal will give you their name in the same breath, and the rule
above still holds — it forbids *deriving* a nickname, not asking for one, and
"what should the site call you?" is one short question about themselves that
they can answer instantly. There is no default and there will not be one.

\`visibility\` has no default either — send \`"public"\` or \`"private"\` and
nothing else, and get one of those two answers from the person before you
call this. See the table above for what the two mean. This document used to
say silence read as \`"public"\`; it did, and a journal asked to be private
was created public because of it (B263). It no longer does — the request is
refused instead.

\`defaultLocale\` is **their** language — ${LOCALE_LIST} on this instance —
and it decides the language of the site's chrome **and of the welcome mail
this server sends the owner the moment the journal exists**. It has no
default either, for the same reason: a German journal created without it used
to greet its owner in English, silently. Ask, and pass the code.

\`locales\` is a different question: which of those same languages **a
reader** may switch the journal into — \`["de", "en"]\` above, meaning the
journal reads in Deutsch or English depending who is looking. It is not the
owner's own language repeated; their audience is not necessarily the same.
**Left out, the journal offers only the one language in \`defaultLocale\` —
no switcher at all**, which is right for an audience who all read that
language and wrong for one that does not. Ask both; they are not the same
answer.

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

## Letting other people in

A journal has no public sign-up form, on purpose. Two links get somebody in,
and **only the journal's owner can issue either** — not a token scoped to one
trip.

\`\`\`http
POST ${site.url}/api/v1/${example}/invites
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"kind": "guest"}
\`\`\`

\`\`\`json
{"ok": true, "invite": {
  "id": "…", "kind": "guest", "scope": "${example}", "trip": null,
  "expiresAt": "…",
  "url": "${site.url}/${example}/invite/guest/fs_inv_…"
}}
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

The token is in the response **once**. Only its hash is stored, so a link that
is lost is reissued, never looked up — do not save it anywhere the person did
not ask for, and do not read it back to them as a credential.

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
\`defaultLocale\`, \`displayCurrencies\` and \`manualRates\`. Send only what you are
changing; \`""\` clears a tagline or a start location. Capabilities and these are
**two calls** — a body naming both is refused rather than half-applied, because
each call rewrites \`config.json\` whole and puts it back if it does not load.
\`GET\` returns all of it under \`journal\`.

Three keys are refused, and each says why. **\`owner.email\`** is the address that
decides who can get a token for this journal, so a token cannot move it.
**\`baseCurrency\`** is not a display setting: a cost written without a
\`currency:\` *is* a cost in the base currency, so changing it would not
reconvert the money, it would change what every amount already recorded means.
**\`media\`** is the operator's — the server's own limits are already a ceiling
over it. All three are an edit at the file, by whoever runs the server.

A journal's \`visibility\` is only whether this instance *advertises* it — the
landing page, \`/documentation.txt\`, the sitemap. A private journal is unlisted,
not locked; who may read a journey is still that trip's own visibility. **Ask
before making one public.**

## Writing

\`\`\`http
GET ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…
\`\`\`

A day needs a trip to live in. If there is none yet, make one — only the
journal's owner can, and a trip-scoped token cannot:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"id": "japan-2027", "title": "Japan", "start": "2027-04-01", "end": "2027-05-15",
 "visibility": "private"}
\`\`\`

\`start\` and \`end\` are required: a trip without both is skipped when the site
reads it, so it would exist on disk and nowhere a reader could find it. If you
wrote a \`trip.md\` yourself rather than posting here, read the list back — a
folder the site refused comes back under \`malformed\`, saying what is wrong
with it, instead of quietly not being there. They
also decide the trip's status — a trip whose \`start\` has passed shows its days,
one whose \`start\` is still ahead shows a countdown — so there is no
\`"status"\` to send unless this is the trip the bare \`/${example}\` URLs should
serve, which is \`"status": "current"\`.

A trip is created **private** unless you say otherwise. Publishing somebody's
journey is their decision — ask before sending \`"visibility": "public"\`.

\`"costsVisibility": "guests"\` is the separate question of the money, and only
of the money: among the readers already allowed to open the trip, it keeps what
it cost to the people who were on it and the readers the owner has approved
into the journal. Left out, the numbers are shown to everyone who can read the
trip. A title or a tagline must be one line — both are written as a single line
of the trip's frontmatter, and a request carrying a line break in either is
refused rather than written.

Add \`"test": true\` if this trip is being made to check that the software works
rather than to record a journey. Every day of it then carries the banner, and
none of it reaches the feed, the search index or the sitemap.

**Three fields can only be set here, because nothing edits a \`trip.md\`
afterwards.** Ask before sending any of them, and leave out what you were not
told.

| | |
| --- | --- |
| \`people\` | Who took the trip — \`[{"name": …, "email": …, "nickname": …}]\`, at most ten. It is the byline **and it is write access**: everyone named may write to the whole trip and may ask for a token scoped to it, using the address given. A malformed entry is refused by name rather than dropped. |
| \`rates\` | This trip's frozen rates — \`{"THB": 0.0245}\` reads "1 THB = 0.0245" of the journal's base currency, so a currency worth less than the base one has a **small** number. \`content/rates/ecb.json\` points the other way round. Leaving a currency out is supported: its costs are reported as unconverted rather than guessed at. |
| \`translations\` | The title and tagline in the journal's other languages — \`{"de": {"title": …, "tagline": …}}\`. A language the journal does not declare is refused, since it would be written and never rendered. |

There is no \`cover\`. A trip has no photographs when it is created — media is
attached to a day, and there are no days yet — so a cover is a line somebody
adds to \`trip.md\` once the pictures are in.

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/days
Authorization: Bearer fs_agent_…
Content-Type: application/json

{
  "title": "Lanterns of Hoi An",
  "date": "2026-08-26",
  "time": "16:45",
  "location": "Hoi An",
  "country": "Vietnam",
  "lat": 15.8801,
  "lng": 108.338,
  "content": "The whole old town hangs with lanterns...",
  "tags": ["vietnam"],
  "idempotency_key": "one-key-per-day-you-write"
}
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
| \`lat\`, \`lng\` | Numbers, not strings. |
| \`tags\` | Lowercase letters, digits and single hyphens. |
| \`costs\` | \`[{"label": "Coffee", "amount": 4.5, "currency": "EUR", "category": "food"}]\` — \`label\` and \`amount\` required. No \`currency\` means the journal's base currency; amounts are never converted on the way in. |
| \`transportMode\`, \`transportFrom\`, \`transportTo\` | How the day was travelled. The modes are in the table further down. |
| \`test\` | \`true\` when this day did not happen. See **The one rule**. |
| \`idempotency_key\` | Names this one write — see below. |

There is no \`gallery\` field and no \`status\` field. Photographs go to the media
endpoint, which puts them in the day for you; and what this writes is always a
draft.

**The slug comes from the title, and no two days in a trip may share one.** A
slug is a day's address inside its trip, so a second day holding one could
never be served — the write is refused with \`409\` naming the day that already
has it, rather than accepted and lost. Titles collide more easily than they
look: punctuation and accents are folded, so \`Đà Lạt\` and \`Ðà Lạt\` are both
\`da-lat\`. If you meant two days, give them titles that differ in a word.

**\`idempotency_key\` works here, not only over MCP.** Send one on every write.
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

When you have finished writing, end your report with what is waiting:
\`GET /api/v1/${example}/drafts\` lists it, and this is the call that acts on
their answer.

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

### Photographs and video

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Authorization: Bearer fs_agent_…
Content-Type: multipart/form-data

day=lanterns-of-hoi-an
files=@DSC_4471.HEIC
files=@DSC_4472.HEIC
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

\`kept.filename\` is **advisory** — it is what the source called the file, not
what is on disk. Sending bytes, that is your own filename and correlates. From
a URL it is the last path segment, so \`…/seed/x/3000/2000\` reports
\`"2000.jpg"\`; the stored name is \`01.jpg\` either way. Correlate by position:
\`kept[n]\` is \`items[n]\` is the n-th file you sent.

\`day\` is required and must name a day that already exists in this trip. A
**published** day is refused with \`409\`: adding photographs to something people
have already read changes what they read, and that is a person's decision.

Over MCP the same thing is \`add_media\`, taking base64 — fine for a handful, but
base64 costs a third more than the bytes themselves, so use this endpoint for a
real card full.

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

**Or give it URLs instead of bytes**, and this server downloads them:

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Authorization: Bearer fs_agent_…
Content-Type: application/json

{"day": "lanterns-of-hoi-an", "urls": ["https://…/one.jpg", "https://…/two.jpg"]}
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

### What is accepted

| | |
| --- | --- |
| images | ${IMAGE_FORMATS.join(", ")} — at most ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB, ${IMAGE_MAX_EDGE}px on the longest edge |
| video | ${VIDEO_FORMATS.join(", ")} — at most ${(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)} MB and ${VIDEO_MAX_SECONDS}s. Needs ffmpeg on the server; if it is missing the refusal says so |
| per day | at most ${MAX_ITEMS_PER_DAY} items, counting what the day already holds |
| per request | at most ${MAX_ITEMS_PER_DAY} items — the same number, so a batch too big for one call is too big for one day, and splitting it will not help |
| per journal | whatever this instance's \`media.perUserBytes\` says, if anything |
| tags | lowercase letters, digits and single hyphens, up to ${TAG_MAX_LENGTH} characters |
| transport | ${TRANSPORT_MODES.join(", ")} |

These are this instance's defaults, from lib/validate/. An operator can change
any of them in the \`media\` block of \`content/config.json\`, and a journal may
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

The whole entry, and a \`status\` of \`draft\` or \`published\`. **Read your own
work back before you tell somebody it is ready.** You are asked not to invent
anything, and this is how you check that you did not — that the date is the one
you were given, that the place is right, that nothing has been rounded into a
plausible shape. Over MCP the same thing is \`get_day\`, which now returns drafts
too and says in its reply when a day is one.

## The same thing as MCP

If you speak the Model Context Protocol, everything above is also available as
tools at \`${site.url}/api/mcp\` — **Streamable HTTP**, one endpoint, JSON-RPC
over POST. It is a second door onto the same markdown files, not a second
system, and the draft rule holds through it exactly as it does here.

| Tool | |
| --- | --- |
| \`list_trips\` | every trip in the journal, including private ones |
| \`get_day\` | one day, as the markdown that made the page — drafts included |
| \`search_entries\` | full-text across the journal, private trips included |
| \`list_drafts\` | what is waiting for a person, and which of it nobody lived |
| \`create_day\` | write a day — **as a draft**, always |
| \`publish_day\` | put a draft on the site, once the person has said so |
| \`set_journal_features\` | switch one of the journal's capabilities on or off |

The list is filtered by what this journal can actually do: a tool whose
capability is switched off is **absent** from \`tools/list\` rather than offered
and then refused. So the tools you are shown are the tools that work.

Authenticate with the same agent token, in the same header. There is no
separate OAuth authorization server to log in to; the token you already have is
the credential. The server describes itself at
\`${site.url}/.well-known/oauth-protected-resource\` (RFC 9728), and
\`docs/providers/mcp.md\` in the repository says plainly what that does and does
not amount to.

\`\`\`http
POST ${site.url}/api/mcp
Authorization: Bearer fs_agent_…
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"create_day","arguments":{
   "trip":"<trip-id>","title":"…","date":"2026-08-26","content":"…",
   "idempotency_key":"one-key-per-day-you-write"}}}
\`\`\`

Pass \`idempotency_key\` on every write, over this door or the REST one — both
accept it and both mean the same thing by it. If you retry and the first
attempt had already landed, you get the first result back instead of a conflict
— which is the difference between "already written" and "write it again under a
different title".

**A new key for every day.** The key names one write, not your session or your
connection. Send the same key with the same arguments and you get the first
answer back; send it with *different* arguments and the call is refused and
nothing is written — because the alternative is answering your new day with the
old day's result and reporting success, and there is no way for you to notice
that. If a refusal says the key was already used, you have reused one: pick a
new key and send the day again.

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

## Errors

Every error carries an \`error\` field naming the case. **Read that, not only the
status** — two of these statuses mean two different things, and the field is
what tells them apart.

| Status | \`error\` | Meaning |
| --- | --- | --- |
| \`400\` | \`invalid_entry\` | The body has a \`problems\` list: every problem at once, each naming the field, what arrived and what was expected. |
| \`401\` | \`missing_token\`, \`invalid_token\` | No token, a wrong one, or an expired one. Ask for a new code. |
| \`403\` | \`out_of_scope\` | The token is valid but belongs to a different journal, or is scoped to one trip and you asked about another. |
| \`403\` | \`access_revoked\` | The person this token belongs to has been taken off the trip. The token stays valid for everything else it can reach, and **will not work on this trip again** — do not ask for a new code, it will be refused too. Tell the person to talk to the journal's owner. |
| \`404\` | \`unknown_trip\` | No such trip, or not one this token may write to. **Fix the id.** |
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
