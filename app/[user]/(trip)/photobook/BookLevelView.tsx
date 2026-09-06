"use client";

import type { TranslationKey } from "@/lib/i18n";
import type { BookOptions } from "@/lib/photobook/options";
import type { MediaTile } from "@/lib/types";
import BookSettingsPanel from "./BookSettingsPanel";

type PreviewState = {
  html: string;
  pages: number;
  volumes: number;
  credits: number;
  warnings: { code: string; detail: string; date?: string }[];
  buyable: boolean;
} | null;

/**
 * One row per kind of warning rather than one per photograph.
 *
 * A book whose photographs are all web copies raises a `low-resolution` line
 * for every one of them — forty-three on the demo journal — and rendering them
 * flat buried the price, the preview and the Pay button under a wall of
 * yellow. The count is the part somebody needs to see; the files are the part
 * they need when they go looking.
 */
function groupWarnings(
  warnings: { code: string; detail: string }[],
): { code: string; count: number; details: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const w of warnings) {
    const seen = groups.get(w.code) ?? [];
    seen.push(w.detail);
    groups.set(w.code, seen);
  }
  return [...groups.entries()].map(([code, details]) => ({
    code,
    count: details.length,
    details,
  }));
}

/**
 * Level 1 — the whole book: settings, the live spread preview, warnings,
 * price, Pay. B534's whole point is that this is short enough to reach Pay
 * without meeting a single per-day control, so nothing about one day lives
 * here — a spread is drilled into from the preview itself, which is what the
 * "tap a spread" hint below the iframe is for.
 *
 * Rendered with `hidden` rather than unmounted while level 2 is open (see
 * `PhotobookPageContent`): the iframe's own scroll position is what makes
 * "back returns to the spread you came from" true for free.
 */
export default function BookLevelView({
  hidden,
  options,
  setOptions,
  media,
  locales,
  resetBook,
  canReset,
  preview,
  submitting,
  setSubmitting,
  orderId,
  entryUsername,
  tripRef,
  balance,
  t,
}: {
  hidden: boolean;
  options: BookOptions;
  setOptions: (update: (o: BookOptions) => BookOptions) => void;
  media: MediaTile[];
  locales: string[];
  resetBook: () => void;
  canReset: boolean;
  preview: PreviewState;
  submitting: boolean;
  setSubmitting: (v: boolean) => void;
  orderId: string;
  entryUsername: string;
  tripRef: string;
  balance: number | null;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const credits = preview?.credits ?? null;
  const tooPoor = balance !== null && credits !== null && balance < credits;
  const unbuyable = preview?.buyable === false;

  return (
    <div hidden={hidden} className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
      <BookSettingsPanel
        options={options}
        setOptions={setOptions}
        media={media}
        locales={locales}
        resetBook={resetBook}
        canReset={canReset}
        t={t}
      />

      <div>
        <iframe
          srcDoc={preview?.html ?? ""}
          className="h-[70vh] w-full rounded-xl border border-navy-200 bg-white"
          title={t("photobook.title")}
        />
        <p className="mt-2 text-xs text-navy-600">{t("photobook.composer.tapHint")}</p>

        <div className="mt-4 space-y-2 text-sm">
          {preview && (
            <p className="text-navy-700">
              {t("photobook.pages", { pages: String(preview.pages), volumes: String(preview.volumes) })}
            </p>
          )}
          {credits !== null && (
            <p className="font-semibold text-navy-900">{t("photobook.price", { credits: String(credits) })}</p>
          )}
          {balance !== null && (
            <p className="text-navy-600">{t("photobook.balance", { balance: String(balance) })}</p>
          )}

          {/* Shown above the button, not folded into a details element —
              these describe failures invisible on screen and obvious on
              paper, and folding them away is how one gets missed. */}
          {preview && preview.warnings.length > 0 && (
            <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
              <ul className="space-y-2">
                {groupWarnings(preview.warnings).map((group) => (
                  <li key={group.code}>
                    <p className="text-sm font-semibold">
                      {group.count > 1
                        ? t("photobook.warning.many", { count: String(group.count), code: group.code })
                        : group.code}
                    </p>
                    {group.count === 1 ? (
                      <p className="text-sm">{group.details[0]}</p>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-sm">{t("photobook.warning.each")}</summary>
                        <ul className="mt-1 space-y-1 text-sm">
                          {group.details.map((detail, i) => (
                            <li key={i}>{detail}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <form
            method="post"
            action={`/${entryUsername}/photobook/order`}
            onSubmit={() => setSubmitting(true)}
          >
            <input type="hidden" name="trip" value={tripRef} />
            <input type="hidden" name="options" value={JSON.stringify(options)} />
            <input type="hidden" name="orderId" value={orderId} />
            <button
              type="submit"
              disabled={submitting || tooPoor || unbuyable || !preview}
              className="min-h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("photobook.pay")}
            </button>
            {/* The build is synchronous and a long trip is tens of seconds of
                PDF rendering — this is the only sign the page gives that the
                press was heard, between the click and the redirect. */}
            {submitting && (
              <p className="mt-2 text-sm text-navy-700" role="status">
                {t("photobook.building")}
              </p>
            )}
            {unbuyable && <p className="mt-2 text-sm text-red-700">{t("photobook.noPhotos")}</p>}
            {tooPoor && credits !== null && balance !== null && (
              <p className="mt-2 text-sm text-red-700">
                {t("photobook.tooPoor", { credits: String(credits), balance: String(balance) })}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
