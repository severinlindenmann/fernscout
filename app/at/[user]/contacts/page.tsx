import { permanentRedirect } from "next/navigation";

import { journalPath } from "@/lib/journalPath";
/**
 * The owner's readers page — moved into the studio as `/[user]/studio/readers`
 * by B2092. Kept as a route so an approval mail already sent (which links
 * here with `?contact=<id>`, B319) still lands on the request it was about.
 * No owner check here: the studio page is the one place that decides.
 */
export default async function ContactsRedirectPage({ params, searchParams }: PageProps<"/at/[user]/contacts">) {
  const { user } = await params;
  const { contact } = await searchParams;
  const query = typeof contact === "string" ? `?contact=${encodeURIComponent(contact)}` : "";
  permanentRedirect(`${journalPath(user)}/studio/readers${query}`);
}
