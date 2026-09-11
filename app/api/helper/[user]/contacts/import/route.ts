import { isEnabled } from "@/lib/capabilities";
import {
  importContactRows,
  MAX_IMPORT_ROWS,
  TooManyRowsError,
  type ImportRow,
} from "@/lib/contacts/importRows";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * The press behind `import_contacts` (`lib/helper/tools/areas/files.ts`) —
 * B1394.
 *
 * The card names each row by a `sel_<n>` checkbox and carries the parsed
 * rows themselves in one `vcard_rows` field the person never sees (fixed,
 * resolved server-side when the card was proposed) — the same shape `attach_files`
 * uses for a comma-joined id list, here JSON because a row is more than an
 * id. This route zips the two back together, keeps only what was ticked,
 * and hands the result to `importContactRows` — the same function
 * `POST /api/v1/<user>/contacts/import` calls, so a row filed from a card in
 * the conversation and one filed by an agent over the API land exactly the
 * same way: `pending`, with its own confirmation mail, never pre-approved.
 *
 * Cookie only, owner only, outside `/api/v1` — the same door as every other
 * helper write.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/contacts/import">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const config = getUser(user);
  if (!config || !isEnabled("contacts", user)) {
    refused(user, "import_contacts", "contacts_disabled");
    return Response.json({ error: "contacts_disabled" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(String(body.vcard_rows ?? "[]"));
  } catch {
    parsed = [];
  }
  const rows = Array.isArray(parsed) ? (parsed as ImportRow[]) : [];

  // Only what was ticked — a `sel_<n>` of anything but `"1"` is a row a
  // person unticked, and it must not be filed anyway. Index-aligned with
  // `rows`, which is exactly how the card built both.
  const chosen = rows.filter((_row, index) => String(body[`sel_${index}`] ?? "") === "1");

  if (chosen.length === 0) {
    refused(user, "import_contacts", "no_rows");
    return Response.json({ error: "no_rows", message: "Nothing was ticked, so nothing was filed." }, { status: 400 });
  }

  // The bound is the writer's, because every row sends somebody a letter and
  // both doors have to hold it — see MAX_IMPORT_ROWS. Answering it here rather
  // than letting it throw keeps the card's own refusal readable.
  if (chosen.length > MAX_IMPORT_ROWS) {
    refused(user, "import_contacts", "too_many_rows");
    return Response.json(
      { error: "too_many_rows", message: new TooManyRowsError(chosen.length).message },
      { status: 400 },
    );
  }

  const results = await importContactRows(user, config, chosen);
  const filed = results.filter((r) => r.outcome === "created" || r.outcome === "updated").length;

  wrote(user, "import_contacts", { filed, results });
  return Response.json({
    filed,
    invalid: results.filter((r) => r.outcome === "invalid").length,
    results,
  });
}
