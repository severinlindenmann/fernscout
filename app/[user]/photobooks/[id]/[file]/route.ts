import fs from "node:fs";
import path from "node:path";
import { isOwner } from "@/lib/contacts/session";
import { orderDir } from "@/lib/photobook/build";
import { verifyFileLink } from "@/lib/photobook/fileLink";
import { ORDER_ID_RE } from "@/lib/photobook/orders";

export const dynamic = "force-dynamic";

/** Only what this feature writes. An allowlist rather than a sanitiser: there
 * are two shapes of file in that directory and no reason to serve a third. */
/**
 * The three files one volume writes, and nothing else — B1229.
 *
 * `book.pdf` is the whole book in one document, cover as page 1 (B1205), and
 * it was missing from here: the build wrote it, the receipt linked to it, and
 * this route answered 404 for the only file a person actually uploads to a
 * printer. The interior and the cover stay downloadable beside it — they are
 * what the API submits and what somebody takes to a different printer.
 *
 * Still a closed pattern rather than a directory listing: `id` and `file` both
 * arrive from a URL and are joined into a path, so this is the boundary where
 * they get checked once for everyone downstream.
 */
const FILE_RE = /^(book|v\d{1,2})(-(interior|cover))?\.pdf$/;

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
 * There are now two ways in. The owner cookie, as above, and a signed link
 * (`lib/photobook/fileLink.ts`): Gelato fetches the PDF from a URL and
 * accepts no upload, so the order it is given carries `?exp=…&sig=…` instead
 * of a session. The signature covers the journal, the order, the file *and*
 * the expiry together, so no one of the four can be changed without
 * invalidating it — a link good for `book-interior.pdf` does not become good
 * for `book-cover.pdf`, and its expiry cannot be pushed out by editing the
 * query. Either way in reaches the same file.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/[user]/photobooks/[id]/[file]">,
) {
  const { user, id, file } = await params;
  if (!ORDER_ID_RE.test(id) || !FILE_RE.test(file)) {
    return new Response("Not found", { status: 404 });
  }
  const query = new URL(request.url).searchParams;
  const signed = verifyFileLink(user, id, file, query.get("exp"), query.get("sig"));
  if (!signed && !(await isOwner(user))) return new Response("Not found", { status: 404 });

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
