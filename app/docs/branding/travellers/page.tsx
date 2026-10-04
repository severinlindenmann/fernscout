import type { Metadata } from "next";
import TravellerBench from "@/components/branding/TravellerBench";

/** One of the workbenches — see `app/docs/branding/page.tsx` for what the
 * section is and why none of it is indexed. */
export const metadata: Metadata = {
  title: "Travellers",
  description: "Every word the walking figures are described in, and what each one draws.",
  robots: { index: false, follow: false },
};

export default function TravellerBenchPage() {
  return (
    <div className="bg-surface-base">
      <TravellerBench />
    </div>
  );
}
