"use client";

import { useEffect, useState } from "react";
import { weekdayLabel } from "@/components/extract/DayBoard";
import { useI18n } from "@/components/LocaleProvider";
import { suggestCompanion } from "@/lib/extract/companion";
import type { RunManifest } from "@/lib/staging/manifest";

const MIN_PARTY = 1;
const MAX_PARTY = 20;

/**
 * "Who came" — S8a, B1803 Task 3.6.
 *
 * Asked once, for the whole run, after `DayBoard` — the design's own reason
 * for the ordering is the point of this screen: by then the person's own
 * answers may already name a companion, so the suggestion below can draw on
 * them instead of asking cold.
 *
 * **Figure drawing is out of scope.** S8b ("Draw the two of you") is its
 * own ticket, its own consent and its own cost story; nothing here leads
 * into it.
 *
 * **The suggestion is never invented.** `suggestCompanion` (`lib/extract/
 * companion.ts`) reads only the person's own `DayRow.words`, and returns
 * `null` — rendering nothing here, not a placeholder — the moment it has no
 * clear candidate. See that module's own doc comment for exactly what
 * counts as clear.
 *
 * **What is saved is not the trip's `people:`.** `PATCH .../extract/party`
 * writes to the run's own manifest, never to `trip.json` — see that route's
 * doc comment. Nobody's email is asked for here because nothing here grants
 * anybody write access to anything; it is only ever the shape of the trip
 * ("how many"), kept private to the owner.
 */
export default function WhoCameScreen({
  username,
  runId,
  onDone,
  onBack,
}: {
  username: string;
  runId: string;
  onDone: () => void;
  /** The header's own back arrow (S8a: `← Who came`) — steps back onto the
   *  board, the same place "Done for now" just left, so a person who wants
   *  to fix an answer before naming who came is not stuck here to do it.
   *  Optional only so a caller with nowhere to send it back to (a test, a
   *  future entry point) does not have to invent one. */
  onBack?: () => void;
}) {
  const { t, locale } = useI18n();
  const [manifest, setManifest] = useState<RunManifest | null>(null);
  const [error, setError] = useState(false);
  const [size, setSize] = useState(2);
  const [names, setNames] = useState<[string, string]>(["", ""]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  async function load() {
    setError(false);
    try {
      const res = await fetch(
        `/api/helper/${encodeURIComponent(username)}/extract/run?run=${encodeURIComponent(runId)}`,
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { manifest: RunManifest };
      setManifest(json.manifest);
      if (typeof json.manifest.partySize === "number") setSize(json.manifest.partySize);
      const saved = json.manifest.partyNames;
      setNames([saved?.[0] ?? username, saved?.[1] ?? ""]);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username, runId]);

  const suggestion = manifest ? suggestCompanion(manifest, locale) : null;
  // Nothing is suggested once the second name is already something other
  // than the placeholder this screen started with — a person who has
  // already named their companion does not need to be asked again.
  const showSuggestion = suggestion && names[1].trim() === "";

  async function save() {
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/extract/party`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: runId, size, names: names.filter((n) => n.trim() !== "") }),
      });
      if (!res.ok) throw new Error(String(res.status));
      onDone();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mt-4">
        <p className="text-sm text-red-700">{t("extract.whoCame.error")}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-2 inline-flex min-h-11 items-center rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong"
        >
          {t("err.retry")}
        </button>
      </div>
    );
  }

  if (!manifest) {
    return <p className="mt-4 text-sm text-ink-secondary">{t("extract.board.loading")}</p>;
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm font-semibold text-ink-strong"
            aria-label={t("extract.whoCame.header")}
          >
            ← {t("extract.whoCame.header")}
          </button>
        ) : (
          // The header names the screen even with nowhere wired to send a
          // back-press — S8a's header is item 1 of the spec regardless of
          // whether a caller gave this a place to go back to.
          <span className="text-sm font-semibold text-ink-strong">← {t("extract.whoCame.header")}</span>
        )}
      </div>
      <h2 className="font-display text-xl font-semibold text-ink-strong">{t("extract.whoCame.title")}</h2>

      <div className="flex items-center justify-center gap-4 rounded-2xl border border-line-faint bg-surface-subtle p-4">
        <button
          type="button"
          aria-label={t("extract.whoCame.fewer")}
          disabled={size <= MIN_PARTY}
          onClick={() => setSize((n) => Math.max(MIN_PARTY, n - 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-lg font-semibold text-ink-strong disabled:opacity-40"
        >
          −
        </button>
        <span className="font-display text-3xl text-ink-strong">{size}</span>
        <button
          type="button"
          aria-label={t("extract.whoCame.more")}
          disabled={size >= MAX_PARTY}
          onClick={() => setSize((n) => Math.min(MAX_PARTY, n + 1))}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-line-strong text-lg font-semibold text-ink-strong disabled:opacity-40"
        >
          +
        </button>
      </div>

      <div className="rounded-2xl border border-line-faint bg-surface-raised p-4">
        <p className="text-sm font-semibold text-ink-strong">{t("extract.whoCame.namesTitle")}</p>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-sm text-ink-secondary">{t("extract.whoCame.you")}</span>
            <input
              value={names[0]}
              onChange={(e) => setNames([e.target.value, names[1]])}
              className="min-w-0 flex-1 rounded-full border border-line-strong px-3 py-1.5 text-right text-sm text-ink-strong"
            />
          </label>
          <label className="flex min-w-0 items-center justify-between gap-3">
            <span className="shrink-0 text-sm text-ink-secondary">{t("extract.whoCame.second")}</span>
            <input
              value={names[1]}
              onChange={(e) => setNames([names[0], e.target.value])}
              placeholder={t("extract.whoCame.tapToName")}
              className="min-w-0 flex-1 rounded-full border border-line-strong px-3 py-1.5 text-right text-sm text-ink-strong"
            />
          </label>
        </div>

        {showSuggestion && (
          <button
            type="button"
            onClick={() => setNames([names[0], suggestion!.name])}
            className="mt-3 block text-left text-sm text-ink-secondary underline decoration-dotted"
          >
            {t("extract.whoCame.suggestion", {
              name: suggestion!.name,
              days: new Intl.ListFormat(locale, { type: "conjunction" }).format(
                suggestion!.dates.map((d) => weekdayLabel(d, locale)),
              ),
            })}
          </button>
        )}
      </div>

      {saveError && <p className="text-sm text-red-700">{t("extract.whoCame.saveError")}</p>}

      <button
        type="button"
        disabled={busy}
        onClick={() => void save()}
        className="inline-flex min-h-11 items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
      >
        {busy ? t("extract.whoCame.saving") : t("extract.whoCame.save")}
      </button>
      <p className="text-sm text-ink-secondary">{t("extract.whoCame.reassure")}</p>
    </div>
  );
}
