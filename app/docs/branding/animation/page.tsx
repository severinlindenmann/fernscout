import type { Metadata } from "next";
import Link from "next/link";
import AnimationWorkbench from "@/components/branding/AnimationWorkbench";

/**
 * `/docs/branding/animation` — the travel scene, taken apart.
 *
 * One of the workbenches under `/docs/branding` — see that page for what the
 * section is, and `BRANDING_BENCHES` in `lib/docs.ts` for the list it renders.
 *
 * **Not indexed.** It is a bench for whoever is working on the drawing — a
 * person who wants to see what is wrong, or an agent that has been told
 * something looks wrong and needs to find out which part. A search engine has
 * no use for it at all.
 *
 * It renders the real components with the real props rather than copies, which
 * is the only property that makes it worth having: a fault that shows here is
 * a fault on the site, and one that does not is not.
 */
export const metadata: Metadata = {
  title: "Travel scene workbench",
  description: "Every part of the travel animation, on its own, held still.",
  robots: { index: false, follow: false },
};

export default function AnimationBrandingPage() {
  return (
    <main id="main" className="min-h-screen bg-cream-50">
      <AnimationWorkbench />
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
