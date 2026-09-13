// GET/PATCH/DELETE /api/v2/{user}/contacts/{id} — B1623, phase 2 step 4.
//
// `status` is deliberately not writable here — see approve/revoke/resend
// beside this file, and social.md §2.3 for why a plain PATCH on `status`
// would be a second, unreviewed way to call `approveContact`.
import { contactPatch } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ok, readDryRun } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import {
  SelfAuthoredContactError,
  deleteContact,
  getContact,
  listContacts,
  normaliseEmail,
  updateContactByOwner,
} from "@/lib/contacts";
import { parseLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { getUser } from "@/lib/users";
import { contactToDoc, sharedContactContext } from "@/lib/api/v2/social";

export const dynamic = "force-dynamic";

async function guard(request: Request, user: string) {
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth;
  if (!getUser(user)) return { ok: false as const, response: fail("no_such_journal", `No journal called "${user}".`, undefined, 404) };
  if (!isEnabled("contacts", user)) {
    return { ok: false as const, response: fail("contacts_disabled", "This journal does not have contacts switched on.", undefined, 409) };
  }
  return auth;
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;

  const contact = await getContact(user, id);
  if (!contact) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
  const doc = contactToDoc(contact, await sharedContactContext(user));
  return ok(doc, { etag: etagFor(doc) });
}

export async function PATCH(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;

  const current = await getContact(user, id);
  if (!current) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);

  const parsed = await request.json().catch(() => null);
  const result = contactPatch.safeParse(parsed);
  if (!result.success) {
    return fail("invalid_request", "This patch is not usable.", { problems: problemsFrom(result.error) });
  }
  const patch = result.data;

  if (patch.email !== undefined) {
    const email = normaliseEmail(patch.email);
    const clash = (await listContacts(user)).find((other) => other.id !== id && other.email === email);
    if (clash) return fail("invalid_request", `"${email}" already belongs to another contact.`, undefined, 409);
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    const preview = {
      ...current,
      name: patch.name ?? current.name,
      email: patch.email ?? current.email,
      locale: patch.locale !== undefined ? parseLocale(patch.locale) : current.locale,
    };
    return ok(contactToDoc(preview, await sharedContactContext(user)));
  }

  try {
    const contact = await updateContactByOwner(user, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.email !== undefined ? { email: patch.email } : {}),
      ...(patch.locale !== undefined && parseLocale(patch.locale) ? { locale: parseLocale(patch.locale)! } : {}),
    });
    if (!contact) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
    return ok(contactToDoc(contact, await sharedContactContext(user)));
  } catch (error) {
    if (error instanceof SelfAuthoredContactError) {
      return fail(
        "self_authored",
        "This row was written by its own address through the traveller self-registration door " +
          "and cannot be rewritten by the owner. Revoke or delete it instead.",
        undefined,
        409,
      );
    }
    throw error;
  }
}

export async function DELETE(request: Request, { params }: RouteContext<"/api/v2/[user]/contacts/[id]">) {
  const { user, id } = await params;
  const guarded = await guard(request, user);
  if (!guarded.ok) return guarded.response;

  const existing = await getContact(user, id);
  if (!existing) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) return ok({ id, deleted: true, dryRun: true });

  const gone = await deleteContact(user, id);
  if (!gone) return fail("unknown_contact", `No contact "${id}" on this journal.`, undefined, 404);
  return ok({ id, deleted: true });
}
