import ExtractHub from "@/components/extract/ExtractHub";
import { requireExtractOwner } from "@/lib/extract/pageGate";

export const dynamic = "force-dynamic";

/**
 * "What do you want to bring in?" — the import's front door, B1797.
 *
 * Before this, `/<user>/extract` *was* the photo flow: a title, a file
 * button, and nothing else. It now offers four doors — photographs to the
 * guided flow that already existed, and location history, contacts and bank
 * statements each to a plain upload that hands the file to the importer
 * already built for it (`ExtractHub`'s own doc comment says which route,
 * and where each one falls short of a full round trip).
 */
export default async function ExtractHubPage({ params }: PageProps<"/[user]/extract">) {
  const { user } = await params;
  await requireExtractOwner(user);
  return <ExtractHub username={user} />;
}
