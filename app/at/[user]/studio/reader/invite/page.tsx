import { permanentRedirect } from "next/navigation";

import { journalPath } from "@/lib/journalPath";
/**
 * The invite flow's old address — B1833 until B2133 folded it into the
 * readers page as its first section. Kept so a bookmark still lands there.
 */
export default async function StudioInviteReaderRedirectPage({ params }: PageProps<"/at/[user]/studio/reader/invite">) {
  const { user } = await params;
  permanentRedirect(`${journalPath(user)}/studio/readers#invite`);
}
