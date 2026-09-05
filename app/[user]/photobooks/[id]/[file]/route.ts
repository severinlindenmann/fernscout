import fs from "node:fs";
import path from "node:path";
import { isOwner } from "@/lib/contacts/session";
import { orderDir } from "@/lib/photobook/build";
import { ORDER_ID_RE } from "@/lib/photobook/orders";

export const dynamic = "force-dynamic";

/** Only what this feature writes. An allowlist rather than a sanitiser: there
 * are two shapes of file in that directory and no reason to serve a third. */
const FILE_RE = /^(book|v\d{1,2})-(interior|cover)\.pdf$/;

/**
 * The book, to the person who paid for it.
 *
 * Owner cookie only, like everything else in this flow. `id` is checked
 * against `ORDER_ID_RE` before it reaches `orderDir()` — which, like
 * `buildPhotobook`, joins its argument straight into a filesystem path and
 * trusts the caller to have validated it — and `file` against the allowlist
 * above before either reaches `path.join`, so neither one climbing with `..`
 * gets as far as a stat call.
 *
 * Worth knowing for the provider work that comes next: **Gelato fetches the
 * PDF from a URL and accepts no upload**, so a reachable, unguessable version
 * of this route is what an order will need. That is a separate change and a
 * separate decision — this one hands the file to a logged-in owner and nobody
 * else.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/[user]/photobooks/[id]/[file]">,
) {
  const { user, id, file } = await params;
  if (!ORDER_ID_RE.test(id) || !FILE_RE.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isOwner(user))) return new Response("Not found", { status: 404 });

  const full = path.join(orderDir(user, id), file);
  if (!fs.existsSync(full)) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(fs.readFileSync(full)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "private, no-store",
    },
  });
}
