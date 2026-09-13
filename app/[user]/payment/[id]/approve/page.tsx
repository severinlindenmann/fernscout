import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ApprovePreview from "@/components/ApprovePreview";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The operator's approve page — `/<user>/payment/<id>/approve#token=…`, B425.
 *
 * **No token in the path anymore** — B1635. It used to be
 * `/<user>/payment/<id>/approve/<token>`, and a browser sends a path to the
 * server on every request: it reached the access log, any proxy log in front
 * of it, and the `Referer` header of anything the page went on to load, all
 * for a credential that is single-use and grants credits. The token now rides
 * in the URL *fragment* instead — `#token=…` — which a browser never sends
 * anywhere, so `ApprovePreview` (a client component) is the only thing that
 * ever reads it, straight out of `location.hash`.
 *
 * This server component therefore checks only that the journal exists; it has
 * no way to see the token and does not try to. The preview ("approve N
 * credits?") and the grant itself both happen from the client, each posting
 * the token in a request body — never the URL.
 */
export default async function ApprovePage({
  params,
}: PageProps<"/[user]/payment/[id]/approve">) {
  const { user, id } = await params;
  const journal = getUser(user);
  if (!journal) notFound();

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <ApprovePreview username={user} paymentId={id} />
      </main>
    </div>
  );
}
