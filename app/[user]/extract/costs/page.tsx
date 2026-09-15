import NonPhotoImport from "@/components/extract/NonPhotoImport";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/** A plain upload onto the statement reader that already exists — B1797.
 *  See `NonPhotoImport`'s own doc comment for what this reads and why it
 *  stops short of writing costs onto a trip. */
export default async function ExtractCostsPage({ params }: PageProps<"/[user]/extract/costs">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return <NonPhotoImport username={user} kind="costs" />;
}
