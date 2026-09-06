import type { Metadata } from "next";
import Link from "next/link";
import PrintBench from "@/components/branding/PrintBench";

/** One of the workbenches — see `app/docs/branding/page.tsx` for what the
 * section is and why none of it is indexed. */
export const metadata: Metadata = {
  title: "Print geometry",
  description: "Bleed, trim, safe area and gutter, from the constants the renderers draw from.",
  robots: { index: false, follow: false },
};

export default function PrintBenchPage() {
  return (
    <main id="main" className="min-h-screen bg-cream-50">
      <PrintBench />
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
