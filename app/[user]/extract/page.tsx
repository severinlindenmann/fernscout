import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { isHelperOwner } from "@/lib/helper/server";
import { speechProvider } from "@/lib/helper/transcribe";
import ExtractFlow from "@/components/extract/ExtractFlow";

/**
 * The camera roll import's own page — B1751, Task 1.3.
 *
 * `isEnabled` gates first: an instance with the capability off has no such
 * page at all, rather than a page explaining a button it will not show. Owner
 * check comes after, and both answer with the same `notFound()` — a stranger
 * asking for somebody else's `/extract` learns nothing about whether the
 * capability is even on here.
 */
export const dynamic = "force-dynamic";

export default async function ExtractPage({ params }: PageProps<"/[user]/extract">) {
  const { user } = await params;
  if (!isEnabled("extract", user)) notFound();
  if (!(await isHelperOwner(user))) notFound();
  return (
    <ExtractFlow
      username={user}
      consentedSpeech={hasHelperConsent(user, "speech")}
      speechProvider={speechProvider()}
    />
  );
}
