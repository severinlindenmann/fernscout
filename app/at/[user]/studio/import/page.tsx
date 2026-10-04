import Link from "next/link";
import StudioPage from "@/components/studio/StudioPage";
import { isEnabled } from "@/lib/capabilities";
import { journalPath } from "@/lib/journalPath";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";

export const dynamic = "force-dynamic";

const HELPER_REPO = "https://github.com/severinlindenmann/fernscout-helper";

/**
 * "Import old trips" — B-2842, the first-visit welcome's third door. Two ways
 * in: the guided photo flow (only where `extract` is on for this journal) and
 * the public helper for years of trips at once, which needs nothing on this
 * server and so is always shown. The owner check comes first.
 */
export default async function StudioImportPage({ params }: PageProps<"/at/[user]/studio/import">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();
  const t = (key: Parameters<typeof translateIn>[1]) => translateIn(locale, key);
  const card = "rounded-2xl border border-line-faint bg-surface-raised p-5";
  const button =
    "mt-4 inline-flex min-h-11 items-center rounded-full border-2 border-ink-strong px-5 font-semibold text-ink-strong no-underline hover:bg-yellow-100";

  return (
    <StudioPage username={user} group="bringIn" title={t("studio.import.title")}>
      <div className="grid gap-4">
        {isEnabled("extract", user) && (
          <section data-card="single" className={card}>
            <h2 className="text-lg font-semibold">{t("studio.import.single.title")}</h2>
            <p className="mt-1 text-sm text-ink-secondary">{t("studio.import.single.body")}</p>
            <Link href={`${journalPath(user)}/studio/photos`} className={button}>
              {t("studio.import.single.cta")}
            </Link>
          </section>
        )}
        <section data-card="bulk" className={card}>
          <h2 className="text-lg font-semibold">{t("studio.import.bulk.title")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.import.bulk.body")}</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
            <li>{t("studio.import.bulk.step1")}</li>
            <li>{t("studio.import.bulk.step2")}</li>
            <li>{t("studio.import.bulk.step3")}</li>
          </ol>
          <a href={HELPER_REPO} target="_blank" rel="noopener" className={button}>
            {t("studio.import.bulk.cta")}
          </a>
        </section>
      </div>
    </StudioPage>
  );
}
