import NonPhotoImport from "@/components/extract/NonPhotoImport";
import PageHeader from "@/components/PageHeader";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/** A plain upload that stages a vCard for the agent room to read — B1797.
 *  See `NonPhotoImport`'s own doc comment: this is the one of the three
 *  that does not fit a full round trip in the browser, and why.
 *
 *  `PageHeader` rather than a hand-rolled back link — B1802. */
export default async function ExtractContactsPage({ params }: PageProps<"/[user]/extract/contacts">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return (
    <div className="min-h-screen">
      <PageHeader />
      <NonPhotoImport username={user} kind="contacts" />
    </div>
  );
}
