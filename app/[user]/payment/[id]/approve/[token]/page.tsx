import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ApproveButton from "@/components/ApproveButton";
import { formatChf } from "@/lib/credits/pricing";
import { approvableByToken } from "@/lib/payments";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The operator's approve page — `/<user>/payment/<id>/approve/<token>`, B425.
 *
 * Reached only from the approval email, which goes to `site.operatorEmail`.
 * The token in the URL is the capability; it is checked here (without being
 * consumed) so the operator sees what they are approving before they press the
 * button. Accepting grants the credits — that happens in the approve route,
 * which spends the token atomically.
 *
 * An unknown, foreign, already-approved, or wrong-token request is a plain
 * 404: the page is no oracle for which requests exist.
 */
export default async function ApprovePage({
  params,
}: PageProps<"/[user]/payment/[id]/approve/[token]">) {
  const { user, id, token } = await params;
  const journal = getUser(user);
  if (!journal) notFound();

  const payment = await approvableByToken(user, id, token);
  if (!payment) notFound();

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <ApproveButton
          username={user}
          paymentId={id}
          token={token}
          credits={payment.credits}
          amount={formatChf(payment.amountRappen)}
        />
      </main>
    </div>
  );
}
