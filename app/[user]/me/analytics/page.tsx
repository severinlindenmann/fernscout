import { permanentRedirect } from "next/navigation";

/**
 * Who is reading this journal — moved whole to `/[user]/studio/visitors` by
 * B2017, so this journal-scoped page has one owner-only door instead of two.
 *
 * Kept as its own route file rather than deleted, so an old bookmark to
 * `/me/analytics` keeps working — the same choice `app/[user]/account/page.tsx`
 * made for `/account` when B2016 moved it. No owner check here:
 * `/studio/visitors` (`requireStudioOwner`, `lib/studio/pageGate.ts`) is the
 * one place that actually decides who may see the page — asking twice would
 * only be two places that could disagree. `?days=` is forwarded rather than
 * dropped, since it is the one thing on this URL a visitor chose.
 */
export default async function VisitorsRedirectPage({
  params,
  searchParams,
}: PageProps<"/[user]/me/analytics">) {
  const { user } = await params;
  const days = (await searchParams).days;
  const query = typeof days === "string" ? `?days=${encodeURIComponent(days)}` : "";
  permanentRedirect(`/${user}/studio/visitors${query}`);
}
