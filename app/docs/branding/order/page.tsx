import type { Metadata } from "next";
import Link from "next/link";
import OrderBench from "@/components/branding/OrderBench";

/** One of the workbenches — see `app/docs/branding/page.tsx` for what the
 * section is and why none of it is indexed. */
export const metadata: Metadata = {
  title: "Orders",
  description: "A photobook order and a postcard order, in the states a reader cannot reach.",
  robots: { index: false, follow: false },
};

export default function OrderBenchPage() {
  return (
    <main id="main" className="min-h-screen bg-cream-50">
      <OrderBench />
      <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <Link
          href="/docs/branding"
          className="text-sm font-semibold text-navy-700 underline decoration-blue-500 decoration-2 underline-offset-2 hover:text-navy-900"
        >
          Back to the workbenches
        </Link>
      </div>
    </main>
  );
}
