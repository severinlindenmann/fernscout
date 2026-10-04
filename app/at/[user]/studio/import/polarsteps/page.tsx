import StudioPage from "@/components/studio/StudioPage";
import PolarstepsImportFlow from "@/components/studio/import/PolarstepsImportFlow";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";

export const dynamic = "force-dynamic";

// Official Polarsteps help article on exporting your data (owner-verified in a browser; the host 403s scripts).
const POLARSTEPS_EXPORT_GUIDE = "https://support.polarsteps.com/hc/en-us/articles/24266264821138-How-can-I-export-a-copy-of-my-data";

/**
 * "Import from Polarsteps" — B2662, beside `studio/location/import`
 * (B2432's server half: the `polarsteps` import kind, reached here through
 * the owner-cookie door `POST /api/helper/{user}/polarsteps`, never the
 * bearer-only v2 one). The whole flow — reading the export ZIP, listing its
 * trips, writing the chosen ones as draft trips and days, uploading each
 * step's own media and GPS — lives client-side in `PolarstepsImportFlow`,
 * since a multi-gigabyte export is read with `File.slice` and never
 * uploaded to this server whole.
 */
export default async function StudioPolarstepsImportPage({ params }: PageProps<"/at/[user]/studio/import/polarsteps">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  return (
    <StudioPage username={user} group="bringIn" title={translateIn(locale, "studio.polarsteps.heading")}>
      <p className="text-sm text-ink-secondary">{translateIn(locale, "studio.polarsteps.intro")}</p>
      <p className="text-sm text-ink-secondary">
        {translateIn(locale, "studio.polarsteps.export.steps")}{" "}
        <a href={POLARSTEPS_EXPORT_GUIDE} target="_blank" rel="noopener noreferrer" className="underline">
          {translateIn(locale, "studio.polarsteps.export.guide")}
        </a>
      </p>
      <PolarstepsImportFlow username={user} />
    </StudioPage>
  );
}
