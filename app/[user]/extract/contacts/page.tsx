import NonPhotoImport from "@/components/extract/NonPhotoImport";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/** A plain upload that stages a vCard for the agent room to read — B1797.
 *  See `NonPhotoImport`'s own doc comment: this is the one of the three
 *  that does not fit a full round trip in the browser, and why. */
export default async function ExtractContactsPage({ params }: PageProps<"/[user]/extract/contacts">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return <NonPhotoImport username={user} kind="contacts" />;
}
