import NonPhotoImport from "@/components/extract/NonPhotoImport";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/** A plain upload onto the GPS importer that already exists — B1797. See
 *  `NonPhotoImport`'s own doc comment for how this one, and the other two
 *  simple imports beside it, actually reach the route. */
export default async function ExtractLocationPage({ params }: PageProps<"/[user]/extract/location">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return <NonPhotoImport username={user} kind="location" />;
}
