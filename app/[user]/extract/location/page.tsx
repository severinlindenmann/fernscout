import NonPhotoImport from "@/components/extract/NonPhotoImport";
import PageHeader from "@/components/PageHeader";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/** A plain upload onto the GPS importer that already exists — B1797. See
 *  `NonPhotoImport`'s own doc comment for how this one, and the other two
 *  simple imports beside it, actually reach the route.
 *
 *  `PageHeader` rather than a hand-rolled back link — B1802. */
export default async function ExtractLocationPage({ params }: PageProps<"/[user]/extract/location">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return (
    <div className="min-h-screen">
      <PageHeader />
      <NonPhotoImport username={user} kind="location" />
    </div>
  );
}
