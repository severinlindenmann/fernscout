import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PaymentCheckout from "@/components/PaymentCheckout";
import { creditsEnabled } from "@/lib/credits";
import { getPayment } from "@/lib/payments";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// Never indexed: it is one person's transaction, reached from a link.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The mock checkout — `/<user>/payment/<id>`, B405.
 *
 * Reached from the "Buy credits" overlay and from the email it sends; the id in
 * the URL is the whole capability (unguessable, scoped to this journal by
 * `getPayment`), so no login is needed — the same design as the manage and
 * delete links. It shows the transaction, its status and how to pay; the Pay
 * button is a preview that records a payment and adds no credits.
 *
 * A missing or foreign id is a 404, the same answer for both, so the page is no
 * oracle for which journal a transaction belongs to.
 */
export default async function PaymentPage({ params }: PageProps<"/[user]/payment/[id]">) {
  const { user, id } = await params;
  const journal = getUser(user);
  // If the server does not charge at all, there are no transactions to show.
  if (!journal || !creditsEnabled()) notFound();

  const payment = await getPayment(user, id);
  if (!payment) notFound();

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PaymentCheckout
          username={user}
          payment={{
            id: payment.id,
            credits: payment.credits,
            amountRappen: payment.amountRappen,
            status: payment.status,
            method: payment.method,
            paidAt: payment.paidAt,
          }}
        />
      </main>
    </div>
  );
}
