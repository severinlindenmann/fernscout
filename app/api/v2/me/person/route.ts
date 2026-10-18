// GET/PUT /api/v2/me/person — B-3007. Identity-cookie surface, like
// /api/v2/me/home: the person across every journal, never one journal's
// contact row.
import { resolveIdentity } from "@/lib/auth/handshake";
import { foreignOrigin } from "@/lib/auth/originCheck";
import { isEnabled } from "@/lib/capabilities";
import { spreadPersonAddress } from "@/lib/contacts";
import { hasContactsKey, isPostable, normaliseAddress } from "@/lib/contacts/crypto";
import { fail, ok, readJson, withV2Log } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { personPut } from "@/lib/api/v2/schemas/person";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { getPersonAddress, subjectsOf } from "@/lib/people";
import { subjectPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export const GET = withV2Log(async function GET() {
  if (!isEnabled("auth")) return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  const identity = await resolveIdentity();
  if (!identity) return fail("not_signed_in", ERROR_CODES.not_signed_in, undefined, 401);
  const subjects = await subjectsOf(identity.email);
  const email = subjects.find((s) => subjectPhone(s) === null) ?? null;
  const phone = subjects.find((s) => subjectPhone(s) !== null) ?? null;
  const saved = await getPersonAddress(identity.email);
  const address = saved
    ? { name: saved.name, line1: saved.line1, line2: saved.line2, postcode: saved.postcode, city: saved.city, country: saved.country }
    : null;
  return ok({ email, phone, address, addresses: hasContactsKey() }, { headers: NO_STORE });
}, { route: "/api/v2/me/person" });

export const PUT = withV2Log(async function PUT(request: Request) {
  if (!isEnabled("auth")) return fail("auth_disabled", ERROR_CODES.auth_disabled, undefined, 404);
  if (foreignOrigin(request)) return fail("foreign_origin", ERROR_CODES.foreign_origin, undefined, 403);
  const identity = await resolveIdentity();
  if (!identity) return fail("not_signed_in", ERROR_CODES.not_signed_in, undefined, 401);
  if (!hasContactsKey()) return fail("contacts_disabled", ERROR_CODES.contacts_disabled, undefined, 404);

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = personPut.safeParse(body.value);
  if (!parsed.success) return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error));
  const address = normaliseAddress(parsed.data.address);
  if (!isPostable(address)) {
    return fail("invalid_request", "An address needs a street (line1), a city and a country.");
  }
  const journals = await spreadPersonAddress(identity.email, address);
  return ok({ ok: true, journals }, { headers: NO_STORE });
}, { route: "/api/v2/me/person" });
