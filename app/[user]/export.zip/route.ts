import { Readable } from "node:stream";
import { authenticate, mayActAsOwner } from "@/lib/api/auth";
import { createUserExportArchive } from "@/lib/exportZip";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `/<username>/export.zip` — the journal, as a zip.
 *
 * **Anonymously**: a copy of what a visitor can already see — public and
 * unlisted trips, drafts stripped (`"open-to-link"` in lib/exportZip.ts).
 *
 * **With the journal owner's agent token**: all of it. The original objection
 * was that an HTTP endpoint would "hand out someone's closed content on a
 * plain GET", and that is right — but a request carrying a Bearer
 * token scoped to this journal is not a plain GET, and the alternative was
 * telling somebody their backup needs shell access to a machine they may not
 * have. `npm run export` is still there for whoever does.
 *
 * Computed per request rather than prerendered: it aggregates every trip's
 * media at once, and duplicating a whole media library into the build output
 * on every `next build` is a worse trade than one archiver pass per download.
 */
export async function GET(request: Request, { params }: RouteContext<"/[user]/export.zip">) {
  const { user } = await params;
  if (!getUser(user)) return new Response("Not found", { status: 404 });

  // A token for a different journal, or an expired one, is simply not the
  // owner: it falls through to the public archive rather than being refused,
  // because the anonymous answer was always available anyway.
  const auth = await authenticate(request);

  /**
   * **Two questions, and this route needs both** — B231.
   *
   * `ownsUser` answers only *which journal a token belongs to*. It used to be
   * the whole gate here, under a local variable called `isOwner`, and the name
   * is most of why it read as correct: a `write:trip:<id>` token — the
   * credential a buddy link produces, the lowest-trust thing this system
   * issues — belongs to the journal, so it satisfied `ownsUser` and selected
   * the `"all"` scope. One GET returned every `private` and `guest` trip in
   * the journal, every `costs.md`, and every unpublished draft, to somebody
   * who had been let onto one trip.
   *
   * `mayActAsOwner` (B240) is the second question, asked the same way every
   * other owner-only route in the API asks it: the unqualified `write:content`
   * scope *and* the address behind the token matching `config.json`'s own
   * `owner.email`, so a scope minted wrong on its own is still not enough.
   *
   * A trip-scoped token falls through to `open-to-link`, exactly as an
   * anonymous caller does. Refusing it outright would say something about the
   * journal it does not need to say, and the public archive is content it
   * could already have fetched. A per-trip archive is a feature, not this fix.
   */
  const wholeJournal = auth.ok && mayActAsOwner(auth.session, user);

  const archive = createUserExportArchive(user, wholeJournal ? "all" : "open-to-link");
  // Errors also propagate through the stream itself; this only prevents a
  // rejected finalize() from becoming an unhandled promise rejection.
  archive.finalize().catch(() => {});

  return new Response(Readable.toWeb(archive) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${user}-export.zip"`,
      // An owner's archive holds private trips and unpublished drafts, and
      // must never sit in a shared cache. The public one is the same bytes for
      // everybody and can.
      "Cache-Control": wholeJournal ? "private, no-store" : "public, max-age=300",
    },
  });
}
