// The existence-and-capability half of the postcards guard, apart from
// ownership — B1674, following the shape `contactsReady` (./social.ts) set
// for invites/channels. `app/api/v2/[user]/postcards/*` (bearer) and
// `app/api/web/[user]/postcards/*` (cookie) each need exactly this check
// after their own, different, way of proving who is asking, and a v2 route
// file cannot import a sibling's (test/api-v2-imports.test.ts forbids any
// import from `app/` inside `app/api/v2/**`), so it lives here instead.
import { isEnabled } from "../../capabilities";
import { getUser } from "../../users";
import { fail } from "./route";
import { ERROR_CODES } from "../errorCodes";

/**
 * Instance-level, never per-journal (decision 5, B1617): a capability
 * answers "is the plumbing configured", the operator's fact — a journal's
 * own `features` block has no say in v2.
 */
export function postcardsReady(user: string): { ok: true } | { ok: false; response: Response } {
  if (!getUser(user)) {
    return { ok: false, response: fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404) };
  }
  if (!isEnabled("postcards")) {
    return { ok: false, response: fail("postcards_disabled", ERROR_CODES.postcards_disabled, undefined, 404) };
  }
  if (!isEnabled("contacts")) {
    return { ok: false, response: fail("contacts_disabled", ERROR_CODES.contacts_disabled, undefined, 404) };
  }
  return { ok: true };
}
