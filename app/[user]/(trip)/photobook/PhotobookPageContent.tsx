"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "@/components/mediaLoader";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { DEFAULT_OPTIONS, type BookOptions } from "@/lib/photobook/options";
import type { MediaTile, PhotobookEntry } from "@/lib/types";

type PreviewState = {
  html: string;
  pages: number;
  volumes: number;
  credits: number;
  warnings: { code: string; detail: string }[];
} | null;

/**
 * The book's own preview page: options on the left, the printed page on the
 * right, and one Pay button that is the only thing here that spends credits.
 *
 * The preview is server-planned — `POST /<user>/photobook/preview` runs the
 * same `planFor` the paying route does — so this component's job is to hold
 * `BookOptions` in state, ask for a new preview whenever they change, and
 * render whatever comes back. It never lays out a page itself.
 */
export default function PhotobookPageContent({
  entry,
  tripRef,
  tripTitle,
  media,
  balance,
}: {
  entry: PhotobookEntry;
  tripRef: string;
  tripTitle: string;
  media: MediaTile[];
  balance: number | null;
}) {
  const { t } = useI18n();
  const [options, setOptions] = useState<BookOptions>(DEFAULT_OPTIONS);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [submitting, setSubmitting] = useState(false);

  // The double-press guard for the Pay button lives on the server
  // (`ORDER_ID_RE`, `claimOrder`), and it needs one id per visit to this
  // page rather than one per press — generated once, in the initialiser, so
  // a re-render (an option changing, a preview arriving) never hands the
  // form a second id to race the first against.
  const [orderId] = useState(() => crypto.randomUUID());

  const excluded = new Set(options.excludePhotos);
  const toggle = (src: string) =>
    setOptions((o) => ({
      ...o,
      excludePhotos: excluded.has(src)
        ? o.excludePhotos.filter((s) => s !== src)
        : [...o.excludePhotos, src],
    }));

  // Debounced: every keystroke and every tile click changes `options`, and
  // each one plans and lays out the whole book server-side. 400 ms is long
  // enough that a run of clicks collapses into one request and short enough
  // that the preview still feels like it is following you.
  const requestId = useRef(0);
  useEffect(() => {
    const mine = ++requestId.current;
    const timer = setTimeout(() => {
      fetch(`/${entry.username}/photobook/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripRef, options }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          // A slower request that started earlier must not overwrite a
          // faster one that started later — the classic out-of-order
          // response, and the only guard this component needs against it.
          if (mine === requestId.current) setPreview(data);
        })
        .catch(() => {
          if (mine === requestId.current) setPreview(null);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [entry.username, tripRef, options]);

  const credits = preview?.credits ?? null;
  const tooPoor = balance !== null && credits !== null && balance < credits;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("photobook.title")}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {tripTitle} — {t("photobook.intro")}
        </p>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,20rem)_1fr]">
          <div className="space-y-6">
            <label className="block">
              <span className="text-sm font-semibold text-navy-800">
                {t("photobook.option.size")}
              </span>
              <select
                value={options.size}
                onChange={(e) => setOptions((o) => ({ ...o, size: e.target.value }))}
                className="mt-1 block w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm"
              >
                {Object.values(BOOK_SIZES).map((size) => (
                  <option key={size.id} value={size.id}>
                    {size.name}
                  </option>
                ))}
              </select>
            </label>

            <fieldset>
              <legend className="text-sm font-semibold text-navy-800">
                {t("photobook.option.binding")}
              </legend>
              <div className="mt-1 space-y-1">
                {(["perfect", "saddle"] as const).map((binding) => (
                  <label key={binding} className="flex items-center gap-2 text-sm text-navy-700">
                    <input
                      type="radio"
                      name="binding"
                      checked={options.binding === binding}
                      onChange={() => setOptions((o) => ({ ...o, binding }))}
                    />
                    {t(
                      binding === "perfect"
                        ? "photobook.option.bindingPerfect"
                        : "photobook.option.bindingSaddle",
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-1">
              {(
                [
                  ["includeText", "photobook.option.text"],
                  ["includeMap", "photobook.option.map"],
                  ["includeChapters", "photobook.option.chapters"],
                  ["includeNames", "photobook.option.names"],
                  ["includeCosts", "photobook.option.costs"],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-navy-700">
                  <input
                    type="checkbox"
                    checked={options[key]}
                    onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
                  />
                  {t(label)}
                </label>
              ))}
            </fieldset>

            <div>
              <p className="text-sm font-semibold text-navy-800">{t("photobook.option.photos")}</p>
              <p className="mt-1 text-xs text-navy-600">{media.length - excluded.size} / {media.length}</p>
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {media.map((tile, i) => (
                  <button
                    key={tile.src}
                    type="button"
                    onClick={() => toggle(tile.src)}
                    // Pressed means "included in the book" — the state the
                    // grid started every tile in, and the one the toggle's
                    // label below names.
                    aria-pressed={!excluded.has(tile.src)}
                    // `alt=""` on the `<Image>` below is correct — the tile
                    // is decorative next to this label, not the other way
                    // round. Without it a screen reader announces a grid of
                    // unlabelled toggle buttons; the caption is the best name
                    // when there is one, and a position when there is not.
                    aria-label={
                      tile.caption || t("photobook.option.photoName", {
                        index: String(i + 1),
                        total: String(media.length),
                      })
                    }
                    className={`relative aspect-square overflow-hidden rounded-md border ${
                      excluded.has(tile.src) ? "border-navy-200 opacity-30" : "border-yellow-500"
                    }`}
                  >
                    <Image
                      src={tile.src}
                      loader={mediaLoader}
                      alt=""
                      fill
                      sizes="10vw"
                      className="object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <iframe
              srcDoc={preview?.html ?? ""}
              className="h-[70vh] w-full rounded-xl border border-navy-200 bg-white"
              title={t("photobook.title")}
            />

            <div className="mt-4 space-y-2 text-sm">
              {preview && (
                <p className="text-navy-700">
                  {t("photobook.pages", {
                    pages: String(preview.pages),
                    volumes: String(preview.volumes),
                  })}
                </p>
              )}
              {credits !== null && (
                <p className="font-semibold text-navy-900">
                  {t("photobook.price", { credits: String(credits) })}
                </p>
              )}
              {balance !== null && (
                <p className="text-navy-600">
                  {t("photobook.balance", { balance: String(balance) })}
                </p>
              )}

              {/* Shown above the button, not folded into a details element —
                  these describe failures invisible on screen and obvious on
                  paper, and folding them away is how one gets missed. */}
              {preview && preview.warnings.length > 0 && (
                <ul className="rounded-lg border border-yellow-300 bg-yellow-50 p-3 text-yellow-900">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>
                      <code>{w.code}</code> {w.detail}
                    </li>
                  ))}
                </ul>
              )}

              <form
                method="post"
                action={`/${entry.username}/photobook/order`}
                onSubmit={() => setSubmitting(true)}
              >
                <input type="hidden" name="trip" value={tripRef} />
                <input type="hidden" name="options" value={JSON.stringify(options)} />
                <input type="hidden" name="orderId" value={orderId} />
                <button
                  type="submit"
                  disabled={submitting || tooPoor || !preview}
                  className="min-h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("photobook.pay")}
                </button>
                {tooPoor && credits !== null && balance !== null && (
                  <p className="mt-2 text-sm text-red-700">
                    {t("photobook.tooPoor", { credits: String(credits), balance: String(balance) })}
                  </p>
                )}
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
