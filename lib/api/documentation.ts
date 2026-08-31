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
import { getDefaultUsername, getUsernames, getUser } from "../users";
import { getTrips } from "../trips";
import { isIndexable } from "../access";

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
  const users = getUsernames();
  const defaultUser = getDefaultUsername();

  const lines: string[] = [
    `# ${site.name}`,
    "",
    "> A travel journal whose content is markdown and photographs in a folder the",
    "> author owns. Reading happens in a browser. Writing happens through an agent",
    "> holding a token — there is no editing interface, and there will not be one.",
    "",
    "## How to work with this site",
    "",
    "1. Read the guide at " + `${base()}/agent.md` + " — it lists every call, with examples.",
    "2. Ask the person you are working for for the email address that owns their",
    "   journal, and use it to request a code.",
    "3. Exchange the code for a token. It can write for seven days.",
    "",
    "Anything you create arrives as a **draft**. A person publishes it. That is",
    "deliberate and there is no parameter that skips it.",
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
    "Every page has a markdown twin: append `.md` to a day's URL and you get the",
    "source that produced it, rather than the rendering. The content *is* markdown,",
    "so nothing is lost in the conversion — there is no conversion.",
    "",
    "## Writing to this journal",
    "",
    "```",
    `POST ${base()}/api/auth/request`,
    `     {"user": "${username}", "email": "<the owner's address>", "kind": "agent"}`,
    "     -> 202 always. A code is mailed only to the address that owns this journal.",
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
    `- [MCP](${base()}/api/mcp): the same operations as tools — list_trips, get_day, search_entries, list_drafts, create_day`,
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
  const example = getDefaultUsername() ?? getUsernames()[0] ?? "your-username";

  return `# Writing to ${site.name} as an agent

You are reading this because somebody gave you a link and an email address and
asked you to keep their travel journal. This document is everything you need.

## What this is

A travel journal. Content is markdown files and photographs in a folder the
author owns. **There is no editing interface** — no web form, no upload widget,
no CMS. Writing happens through the API below, which is why you are here.

## The one rule

**Everything you create is a draft.** A person publishes it. There is no
parameter, header or endpoint that skips this. If you were hoping to publish
directly: you cannot, and that is the design. One invented memory presented to
somebody's family as fact is not recoverable, so a human always sees it first.

Write what you were told. Do not invent detail to fill a page — no weather you
were not told about, no meals nobody mentioned, no feelings nobody expressed.
If you do not know where a photograph was taken, leave the location empty and
say so.

## Authenticating

Two calls. The token is never sent by email — only a short-lived code is, and
you exchange it over HTTPS.

\`\`\`http
POST ${site.url}/api/auth/request
Content-Type: application/json

{"user": "${example}", "email": "owner@example.com", "kind": "agent"}
\`\`\`

Always answers \`202\`, whether or not that address owns anything. Ask the person
for the six-digit code that arrives in their inbox. It lasts ten minutes, is
single use, and burns after five wrong guesses.

**If the person is not the journal's owner but came on one of its trips**, add
the trip to both calls:

\`\`\`json
{"user": "${example}", "email": "robin@example.com", "kind": "agent", "trip": "asia-2026"}
\`\`\`

The token you get back then writes to **that trip only** — every day of it, not
just theirs — and every other trip in the journal answers as if it did not
exist. Who is on a trip is the \`people:\` block in its \`trip.md\`; a person
adds themselves there, you cannot.

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
| \`GET /${example}/day/<slug>.md\` | a day's markdown source |
| \`GET /${example}/search-index.json\` | every public entry, for finding things |
| \`GET /${example}/feed.xml\` | public entries as RSS |

## Writing

\`\`\`http
GET ${site.url}/api/v1/${example}/trips
Authorization: Bearer fs_agent_…
\`\`\`

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
  "tags": ["vietnam"]
}
\`\`\`

\`\`\`json
{"ok": true, "slug": "lanterns-of-hoi-an", "status": "draft",
 "note": "Created as a draft. It is not on the site until a person publishes it."}
\`\`\`

**\`409\` means an entry already exists for that date and title.** You are
probably retrying. Do not work around it by changing the title — ask.

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

### Photographs and video

\`\`\`http
POST ${site.url}/api/v1/${example}/trips/<trip-id>/media
Authorization: Bearer fs_agent_…
Content-Type: multipart/form-data

day=lanterns-of-hoi-an
files=@DSC_4471.HEIC
files=@DSC_4472.HEIC
\`\`\`

Answers with the \`gallery:\` block for what it wrote, ready to paste into the
entry. Over MCP the same thing is \`add_media\`, taking base64 — fine for a
handful, but base64 costs a third more than the bytes themselves, so use this
endpoint for a real card full.

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

### What is accepted

| | |
| --- | --- |
| images | ${IMAGE_FORMATS.join(", ")} — at most ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB, ${IMAGE_MAX_EDGE}px on the longest edge |
| video | ${VIDEO_FORMATS.join(", ")} — at most ${(VIDEO_MAX_BYTES / 1024 / 1024).toFixed(0)} MB and ${VIDEO_MAX_SECONDS}s. Needs ffmpeg on the server; if it is missing the refusal says so |
| per day | at most ${MAX_ITEMS_PER_DAY} items |
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
them what is outstanding.

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
| \`list_drafts\` | what is waiting for a person |
| \`create_day\` | write a day — **as a draft**, always |

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

Pass \`idempotency_key\` on every write. If you retry and the first attempt had
already landed, you get the first result back instead of a conflict — which is
the difference between "already written" and "write it again under a different
title".

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

Over the network you have only the endpoint, which is fine: send the files,
paste the \`gallery:\` block it hands back into the day. Both routes keep the
original and both mark what they create a draft.

## Errors

| Status | Meaning |
| --- | --- |
| \`401\` | No token, a wrong one, or an expired one. Ask for a new code. |
| \`403\` | The token is valid but belongs to a different journal. |
| \`404\` | No such trip — or authentication is switched off on this server. |
| \`409\` | That entry already exists. You are probably retrying. |
| \`429\` | Too many attempts. Wait; the response says how long. |

## What good looks like

- Ask before inventing. An empty field is better than a plausible fiction.
- One entry per day per place, not one per photograph.
- Write in the author's voice, in their language. Check an existing entry first.
- Tell the author what you created and that it is waiting for them.
`;
}
