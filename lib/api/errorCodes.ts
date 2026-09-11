/**
 * Every `error` code this API answers with, and what to do about it.
 *
 * A refusal used to be `{"error": "unsupported_field"}` and nothing else, on
 * 139 of the 149 places a code is returned. For somebody reading the source
 * that is enough; for the only reader this API actually has — an agent over
 * the network, holding `/openapi.json` and no source at all — it is a word to
 * guess at. B540 watched one guess.
 *
 * So the vocabulary is small (59 codes) and it is published: `Error.error` in
 * the document carries this list as an `enum`, and each line below says what
 * the code means **and what to do next**, because "what happened" without
 * "what now" leaves a weak model to invent a fix.
 *
 * `test/openapi-contract.test.ts` fails when a route answers with a code that
 * is not here, and when a code here is answered by no route — so this cannot
 * quietly drift in either direction.
 *
 * Write each sentence for somebody who cannot read this repository.
 */
export const ERROR_CODES: Record<string, string> = {
  // ── who you are, and what you may touch ────────────────────────────────
  missing_token: "No `Authorization: Bearer` header. Every /api/v1 call needs one; get a token from /api/auth/request and /api/auth/verify, both with `\"kind\": \"agent\"`.",
  invalid_token: "The token is not one this server issued, or it has expired. Tokens last seven days — ask for a new one the same way.",
  out_of_scope: "The token is valid, and it belongs to a different journal or a different trip than the one in the URL. Do not retry: ask for a token for this journal.",
  forbidden: "This call is the journal owner's, and the credential is not theirs. A trip-scoped token cannot do it either.",
  not_authorised: "This credential cannot do this. Read /agent.md on which credential each door takes.",
  not_signed_in: "This route takes a browser session cookie, not a bearer token. An agent cannot call it.",
  no_session: "No session cookie, and this route takes nothing else.",
  invalid_handover: "The 20-minute handover credential is spent, expired or not for this journal. The owner makes a new one from their own page.",
  invalid_code: "The six-digit code is wrong, used, or more than 30 minutes old. Ask for a new one; the newest is the only live one.",
  link_spent: "This single-use link has already been followed. It cannot be followed again — ask for a new one.",

  // ── what you asked about does not exist ────────────────────────────────
  no_such_journal: "No journal of that name on this server. Check the username; /documentation.txt lists the ones this instance advertises.",
  unknown_user: "No journal of that name on this instance.",
  unknown_inbox_file:
    "One of the `inbox` ids names nothing staged in this journal — or names something that is not a photograph. Nothing was written and nothing was taken out of the inbox; GET the inbox and send the ids it lists.",
  unknown_trip: "No trip of that id in this journal — or none this token may write to. The two answer alike on purpose, so this cannot be used to ask which trips exist. GET the trips list first.",
  unknown_day: "No day of that slug in this trip. The slug is made from the title and is in the answer to the call that wrote it; GET the days list to see them.",
  missing_day: "The day this call names does not exist yet. Write the day first, then send this.",
  unknown_invite: "No invite of that id, or it has been revoked.",
  unknown_key: "No credential of that id. GET the keys list for the ids this journal has.",
  unknown_order: "No order of that id — a postcard order or a photobook order, whichever this route deals in.",
  unknown_payment: "No payment of that id.",
  invalid_amount:
    "Not a number of credits this server sells — out of range, not a whole number, or off the " +
    "step. The refusal names the three bounds.",
  no_such_device: "No device of that id on this account.",
  not_found: "Nothing at this address.",
  no_costs_file: "This trip has no costs.md yet. PUT the costs once to create it, then PATCH to change it.",
  gone: "This journal or trip was deleted. Its name stays reserved and its old URLs answer 410 rather than 404, so this is not a typo — it is a thing that used to be here.",

  // ── the body is wrong ──────────────────────────────────────────────────
  invalid_json: "The body did not parse as JSON. Check the content-type header and the quoting.",
  invalid_request: "The body is missing something this call needs, or a value is not usable. The `message` says which.",
  bad_request: "The body is not usable. The `message` says why.",
  invalid_entry: "One or more fields of the day are wrong. `problems` lists every one at once — field, what arrived, what was expected — so fix them all and send once, rather than a round trip each.",
  invalid_trip: "One or more fields of the trip are wrong; `problems` lists them. A field name that is not a field is refused here rather than dropped, and the hint names the field you probably meant.",
  invalid_costs: "The budget or a cost line is not usable; `problems` lists each one.",
  invalid_media: "The upload is not usable — a file this server does not take, one too large, or a `day` that is not a day of this trip. /api/health carries the formats and the limits.",
  invalid_email: "That is not an address this server can send to.",
  invalid_user: "`user` is missing from the body. It is the journal's own address segment — the one in its URLs.",
  invalid_listed: "`listed` must be true or false, and it cannot be true on a trip no visibility advertises. A string is refused rather than read as truthy: `\"false\"` would otherwise have advertised the trip.",
  invalid_teaser:
    "`teaser` must be true or false, and it cannot be true on a public trip — there is nothing to tease. It names a `guest` or `private` trip on the trips page without opening it.",
  invalid_test: "`test` must be true or false. A string is refused rather than read as truthy.",
  invalid_costs_visibility: "`costsVisibility` must be `public` or `guests`.",
  invalid_title: "The title is not usable — it must be one line. A line break would end the frontmatter block early, so it is refused rather than folded; put the longer version in the prose.",
  invalid_date: "A date is not a real calendar date, or `end` is before `start`. Dates are `2026-09-01`.",
  invalid_tagline: "The subtitle is not usable — it must be one line, like the title. Send `\"\"` to remove it entirely.",
  invalid_cover: "`cover` must be a `src` this trip's own gallery already carries — read GET .../trips/{trip}/media for the list. `null` or `\"\"` clears it.",
  invalid_accent: "`accent` must be one of the five named colours. `null` or `\"\"` clears it back to no preference.",
  invalid_intro: "`intro` must be text — the trip's own prose, not a frontmatter line.",
  invalid_trip_id: "The trip id must be lowercase letters, digits and single hyphens. It is the URL segment and the folder name.",
  invalid_visibility: "`visibility` must be `private`, `public` or `guest`. An unrecognised value is refused here rather than written, because on the way back in it would read as private and the caller would never know.",
  invalid_people: "An entry in `people` is not usable — each needs a name and an email, and there may be at most ten. They get write access to the trip, so this is refused rather than trimmed.",
  invalid_rates: "A rate is not usable. The shape is `{\"EUR\": 0.94}` — units of the journal's base currency for one unit of the keyed one.",
  invalid_tracks: "A row in `tracks` is not one this server knows, or its value is not true or false. The rows are costs, coordinates and photos.",
  invalid_translations: "A translation names a locale this journal does not declare, or its shape is wrong. Declare the locale first with PATCH .../config, or drop it.",
  trip_exists: "A trip with that id is already here. Ids are the URL, so they are unique within a journal — pick another, or edit the one that exists.",
  trip_unreadable: "The trip was written and could not be read back, which means it would be invisible on the site. Nothing was kept. This is a bug — report it rather than retrying.",
  no_frontmatter: "The file has no frontmatter block, so nothing can be read out of it. This is a fault on disk rather than in your call.",
  invalid_travellers: "A figure in `travellers` has a key or a value this server does not know. `for` is an address out of the trip's `people:`, not a name. GET .../travellers/presets for the vocabulary.",
  unsupported_field: "A field name this call does not take. The `message` lists the ones it does — send only those, and note that publishing is never a field.",
  nothing_to_change: "The body names no field this call writes, so there was nothing to do and nothing was written. The `message` lists the ones it takes.",
  mixed_change: "`features` cannot travel with a profile field. Send it in a call of its own, so switching a capability cannot also rename the journal.",
  expected_urls: "The JSON form of this upload needs `urls`. To send bytes instead, use multipart/form-data.",
  expected_src: "DELETE .../media needs `src` — one or more photographs, exactly as GET .../days/<slug> hands them back.",
  unknown_media: "One or more of `src` is not a photograph this day has. `problems` names each one; nothing was removed.",
  expected_multipart: "This content-type is not one this call takes: multipart/form-data for bytes, application/json for `urls`.",
  body_too_large: "The request is over this server's limit. /api/health says what it is; send the files in smaller batches.",
  no_file: "The import call named no file: use `inbox` with an id from the inbox, multipart `file`, or `text` for a few lines inline.",
  expected_file: "This multipart call wants the export under `file`. One file per call.",
  invalid_body: "The JSON body was not an object this call understands. The `hint` shows the shape.",
  storage_full: "This journal has no room left for what you sent, and nothing was written. The message says how much it holds and how much it is allowed. Delete something, or the owner buys more room — an agent cannot.",
  unknown_kind: "No such kind of data. A kind is what the data *is* (`gps`); a format is who wrote it. GET the import route for the kinds this instance reads.",
  unreadable: "The importer could not read the file at all. If the format was detected it may be the wrong one — name it explicitly. If you named it, the file is not what you said.",
  contract: "The file was read and what came out does not hold up: `problems` says what is wrong in words — coordinates the wrong way round, seconds where milliseconds were meant, an export with no positions. Nothing was written.",
  could_not_fetch: "This server could not fetch one of the `urls`. https only, public hosts only, and it is refused after a redirect to a private address.",
  method_not_allowed: "This route does not take that verb, and the `message` names the one that does what you meant.",
  nothing_to_draw: "No figure to draw. Send `figure` or `party` as JSON.",

  // ── the day is not wrong, it is incomplete ─────────────────────────────
  incomplete_day: "The trip keeps track of something this day says nothing about. `missing` names each one, how to send it, **and how to decline it** — `\"costs\": false` means there was none. Ask the person; never invent a value to get past this.",
  could_not_record_decline: "The decline could not be written into the day. Nothing was changed; retry.",

  // ── publishing, and things already done ────────────────────────────────
  already_published: "This day is already on the site. Nothing was changed.",
  published_day_not_deletable:
    "This day is on the site, and a published day is not deleted here — destroying something people have already read is not a self-served step. Take it off the site first with the unpublish call (reversible); once it is a draft again it can be deleted.",
  already_draft:
    "This day is not on the site, so there was nothing to take down. Nothing was changed — " +
    "and if somebody asked you to take it down because they are worried about who saw it, " +
    "say that it has not been up.",
  not_published: "This day is still a draft. Publish it before sending it to anybody.",
  test_content: "This is content nobody lived — `test: true`. It cannot be sent to real people, which is the point of the flag.",
  idempotency_key_reused: "That `idempotency_key` was used for a different body. Nothing was written. Reuse a key only to retry the same call; send a new key for a new day.",
  not_created: "The thing was not created. The `message` says why.",

  // ── this server cannot do that ─────────────────────────────────────────
  auth_disabled: "This server has authentication switched off entirely, so there are no tokens to hold. /api/health says what it can do.",
  signup_disabled: "This server does not take new journals.",
  phone_required: "A journal needs a proven telephone number as well as a proven address. POST /api/auth/signup/phone/request with the signup token, then /api/auth/signup/phone/verify with the code, and retry.",
  verification_failed: "The phone code could not be sent. Try again in a minute, or check the number.",
  contacts_disabled: "This server has contacts off, so invitations and approvals are unavailable.",
  postcards_disabled: "This server has postcards off.",
  photobook_disabled: "This journal does not have photobooks switched on. /api/health says which capabilities are on and why.",
  credits_disabled: "This server has credits off.",
  mail_disabled: "This server cannot send mail, so anything that would have been mailed has not been.",
  mail_failed: "The mail could not be sent. Nothing else about the call failed; tell the person, and do not retry in a loop.",
  whatsapp_disabled: "This server cannot send WhatsApp messages. Ask for the code by mail instead (leave channel out); nothing was issued and any code already held is still live.",
  whatsapp_failed: "The WhatsApp message could not be sent, so no code is live for that address. Retrying once in a minute is reasonable; a loop is not.",
  sms_disabled: "This server cannot send SMS. Use the WhatsApp confirmation instead; nothing was issued.",
  sms_unreachable: "This server's SMS number cannot reach that number's country — the `message` names the restriction. Use the WhatsApp confirmation instead; nothing was sent and nothing was spent.",
  no_owner_address: "This journal's config.json has no owner address, and this call has to mail somebody. That is an edit to the file.",
  no_database: "This capability stores data and this server has no database configured.",
  provider_unavailable:
    "The provider could not be reached, or refused the request — Stripe for a payment, Gelato for a photobook print. Nothing was charged. Read this response's own `message`: it says whether the failure is transient (retrying is reasonable) or the provider refused this server's own account (retrying will not help; this needs the operator).",
  no_credits: "This journal has no credits left for that.",
  not_for_agents:
    "This spends the owner's money and is done by the owner, from their own page — a token is refused here whatever it is scoped to. Nothing was charged. Report what is needed and let them decide.",
  bad_token: "The single-use token in the body does not verify.",
  bad_method: "That payment method is not one this server takes.",
  too_many_requests: "Too many of these too quickly. `retryAfter` says how long to wait — wait it out rather than retrying immediately.",
};
