import { permanentRedirect } from "next/navigation";

/**
 * Credits and storage — B821, moved whole to `/[user]/studio/account` by
 * B2016, so this journal-scoped page has one owner-only door instead of two.
 *
 * Kept as its own route file rather than deleted, so `/[user]/account` (and
 * an already-sent `#buy` link to it — the photobook and postcard flows both
 * pointed here) keeps working. No owner check here: the browser keeps a hash
 * fragment across a redirect on its own when the target carries none, and
 * `/studio/account` (`lib/studio/pageGate.ts`'s `requireStudioOwner`) is the
 * one place that actually decides who may see the page — asking twice would
 * only be two places that could disagree.
 */
export default async function AccountRedirectPage({ params }: PageProps<"/[user]/account">) {
  const { user } = await params;
  permanentRedirect(`/${user}/studio/account`);
}
