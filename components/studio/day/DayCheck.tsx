"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import { journalPath } from "@/lib/journalPath";
import { NO_PROSE } from "@/lib/helper/draft";

/**
 * "Check your day" — TIX-2, the step after the last part is saved.
 *
 * Every part as readers will see it: photographs, time and place, title and
 * words. With the assistant on, three suggestions arrive for each part, each
 * built from what the owner gave and nothing else:
 *
 * - **tidied words** — punctuation, spelling, paragraphs (`write-day`
 *   polish, whose server-side guard refuses anything it added);
 * - **titles** — up to two, made only of the owner's own words, or none;
 * - **captions** — what is visible in each photograph (`describe-photos`).
 *
 * Nothing is applied while they are shown. "Keep mine" puts a part's own
 * words back; "Compare" shows them beside the tidied ones; only "Looks good"
 * writes the choices (one PATCH per part) and goes on to the publish step,
 * which asks again before anything is on the site. A receipt among the photos
 * is read only when the owner presses its button, and is then held private.
 */

type Saved = { slug: string; trip: string; date: string };
type Photo = { src: string; type: "image" | "video"; caption?: string };
type Entry = { slug: string; date: string; time?: string; title: string; content: string; location?: string; gallery: Photo[] };
type Suggestions = {
  status: "waiting" | "working" | "done" | "failed";
  failure?: "studio.check.planLimit" | "studio.check.failed";
  tidied?: string;
  titles?: string[];
  captions?: Record<string, string>;
};

const PRIMARY =
  "min-h-11 flex-1 rounded-full bg-yellow-400 px-4 text-base font-semibold text-yellow-950 disabled:opacity-50";
const SECONDARY =
  "min-h-11 rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong hover:bg-surface-subtle";

/** The owner's own words, with "…" (NO_PROSE, a day saved without words)
 *  read as none: it is shown as no words and never sent to be tidied. */
function ownWords(entry: Entry | null): string {
  const text = entry?.content ?? "";
  return text.trim() === NO_PROSE ? "" : text;
}

function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export default function DayCheck({ username, saved, assistant }: { username: string; saved: Saved[]; assistant: boolean }) {
  const { t, tn } = useI18n();
  const router = useRouter();
  const user = encodeURIComponent(username);
  const [entries, setEntries] = useState<(Entry | null)[]>(saved.map(() => null));
  const [ideas, setIdeas] = useState<Suggestions[]>(saved.map(() => ({ status: "waiting" })));
  const [keepMine, setKeepMine] = useState<boolean[]>(saved.map(() => false));
  const [title, setTitle] = useState<(string | null)[]>(saved.map(() => null));
  const [useCaptions, setUseCaptions] = useState<boolean[]>(saved.map(() => true));
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [receipts, setReceipts] = useState<Record<string, string>>({});
  const started = useRef(false);

  // no-refresh: suggestions and the receipt's cost; "Looks good" refreshes before it leaves.
  async function post(path: string, body: unknown) {
    const response = await fetch(`/api/helper/${user}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    return { ok: !!response?.ok && !!json?.ok, json, status: response?.status ?? 0 };
  }

  // Read each part back as the server wrote it, then ask the assistant
  // about all of them; each part shows its suggestions as they arrive.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const read: (Entry | null)[] = [];
      for (const day of saved) {
        const response = await fetch(`/api/helper/${user}/day?trip=${encodeURIComponent(day.trip)}&slug=${encodeURIComponent(day.slug)}`).catch(() => null);
        const json = (await response?.json().catch(() => null)) as { preview?: { day?: { entries?: Entry[] } } } | null;
        read.push(json?.preview?.day?.entries?.find((e) => e.slug === day.slug) ?? null);
      }
      setEntries(read);
      setTitle(read.map((e) => e?.title || null));
      if (!assistant) {
        setIdeas(saved.map(() => ({ status: "done" })));
        return;
      }
      // Every part at once, and each part's three questions at once, each
      // shown as it lands (captions take longest); the AI day is counted once
      // per date however many calls share it.
      const merge = (i: number, patch: Partial<Suggestions>) =>
        setIdeas((prev) => prev.map((s, at) => (at === i ? { ...s, ...patch } : s)));
      await Promise.all(
        saved.map(async (day, i) => {
          const entry = read[i];
          merge(i, { status: "working" });
          const hasWords = !!entry && words(ownWords(entry)) > 0;
          const polish = hasWords
            ? post("day/write-day", { trip: day.trip, notes: entry.content, mode: "polish", date: day.date }).then((r) => {
                const prose = (r.json?.draft as { prose?: string } | undefined)?.prose;
                if (r.ok && prose && prose.trim() !== entry!.content.trim()) merge(i, { tidied: prose });
                else if (!r.ok) merge(i, { failure: r.status === 402 ? "studio.check.planLimit" : "studio.check.failed" });
              })
            : null;
          const titles = hasWords
            ? post("day/write-day", { trip: day.trip, notes: entry.content, mode: "titles", date: day.date }).then((r) => {
                if (r.ok && Array.isArray(r.json?.titles)) {
                  merge(i, { titles: (r.json.titles as unknown[]).filter((v): v is string => typeof v === "string" && v.trim() !== "") });
                }
              })
            : null;
          const captions = entry?.gallery.some((p) => p.type === "image")
            ? post("day/describe-photos", { trip: day.trip, slug: day.slug }).then((r) => {
                const list = r.json?.captions as { src: string; caption?: string; skipped?: string }[] | undefined;
                if (r.ok && list) merge(i, { captions: Object.fromEntries(list.filter((c) => c.caption && !c.skipped).map((c) => [c.src, c.caption!])) });
              })
            : null;
          await Promise.all([polish, titles, captions]);
          merge(i, { status: "done" });
        }),
      );
    })();
  }, [assistant, saved, user]);

  const working = ideas.some((s) => s.status === "waiting" || s.status === "working");
  const anyTidied = ideas.some((s) => s.tidied);

  async function readReceipt(i: number, src: string) {
    const day = saved[i];
    setReceipts((prev) => ({ ...prev, [src]: t("studio.check.receiptReading") }));
    const read = await post("day/read-receipt", { trip: day.trip, slug: day.slug, src });
    const receipt = read.json?.receipt as { amount: number; currency: string; label: string | null } | null | undefined;
    if (!read.ok || !receipt) {
      setReceipts((prev) => ({ ...prev, [src]: t(read.status === 402 ? "studio.check.planLimit" : "studio.check.receiptNone") }));
      return;
    }
    const label = receipt.label || t("studio.check.receiptLabel");
    await post("day/costs", { trip: day.trip, slug: day.slug, label, amount: receipt.amount, currency: receipt.currency });
    // no-refresh: the publish step that follows reads the day fresh.
    await fetch(`/api/helper/${user}/day`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: day.trip, slug: day.slug, photoVisibility: { [src]: "private" } }),
    }).catch(() => null);
    setReceipts((prev) => ({
      ...prev,
      [src]: t("studio.check.receiptAdded", { label, amount: String(receipt.amount), currency: receipt.currency }),
    }));
  }

  async function looksGood() {
    setBusy(true);
    setFailed(false);
    const slugs: string[] = [];
    for (let i = 0; i < saved.length; i++) {
      const day = saved[i];
      const entry = entries[i];
      const s = ideas[i];
      const body: Record<string, unknown> = { trip: day.trip, slug: day.slug };
      if (s.tidied && !keepMine[i]) body.content = s.tidied;
      const chosen = title[i];
      if (chosen && chosen !== entry?.title) body.title = chosen;
      if (s.captions && useCaptions[i] && Object.keys(s.captions).length > 0) body.captions = s.captions;
      if (Object.keys(body).length === 2) {
        slugs.push(day.slug);
        continue;
      }
      const response = await fetch(`/api/helper/${user}/day`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const json = (await response?.json().catch(() => null)) as { draft?: { slug?: string } } | null;
      if (!response?.ok) {
        setBusy(false);
        setFailed(true);
        return;
      }
      slugs.push(json?.draft?.slug ?? day.slug);
    }
    router.refresh();
    const [first, ...rest] = slugs;
    const trip = saved[0].trip;
    router.push(
      `${journalPath(user)}/studio/day/publish?day=${encodeURIComponent(first)}&trip=${encodeURIComponent(trip)}${
        rest.length ? `&also=${rest.map(encodeURIComponent).join(",")}` : ""
      }`,
    );
  }

  useStudioBar(
    <div className="flex w-full gap-2">
      {anyTidied && (
        <button type="button" className={SECONDARY} aria-pressed={compare} onClick={() => setCompare(!compare)}>
          {compare ? t("studio.check.hideBefore") : t("studio.check.compare")}
        </button>
      )}
      <BusyButton busy={busy} type="button" className={PRIMARY} disabled={working} onClick={() => void looksGood()}>
        {working ? t("studio.check.working") : t("studio.check.looksGood")}
      </BusyButton>
    </div>,
    { replace: true, desktop: true },
  );

  return (
    <div className="mt-2">
      <h2 className="font-display text-xl font-semibold text-ink-strong">{t("studio.check.title")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t(assistant ? "studio.check.lede" : "studio.check.ledePlain")}</p>
      {failed && (
        <p role="alert" className="mt-3 text-sm text-coral-600">
          {t("studio.check.saveFailed")}
        </p>
      )}
      <ol className="mt-4 space-y-5">
        {saved.map((day, i) => {
          const entry = entries[i];
          const s = ideas[i];
          const own = ownWords(entry);
          const showTidied = !!s.tidied && !keepMine[i];
          const text = showTidied ? s.tidied! : own;
          const images = entry?.gallery.filter((p) => p.type === "image") ?? [];
          const titleChoices = [...new Set([...(entry?.title ? [entry.title] : []), ...(s.titles ?? [])])];
          return (
            <li key={day.slug} className="overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
              {images.length > 0 && (
                <div className="grid grid-cols-3 gap-0.5">
                  {images.slice(0, 3).map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element -- the reader's own derivative URL, sized by ?w=.
                    <img key={p.src} src={`${p.src}?w=480`} alt={s.captions?.[p.src] ?? p.caption ?? ""} className="h-28 w-full object-cover" />
                  ))}
                </div>
              )}
              <div className="space-y-3 p-4">
                <p className="font-mono text-xs uppercase tracking-wide text-ink-secondary">
                  {[saved.length > 1 ? t("studio.flow.partHeading", { index: String(i + 1), total: String(saved.length) }) : null, entry?.time, entry?.location]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {s.status === "working" && (
                  <p role="status" className="text-sm text-ink-secondary">
                    {s.tidied !== undefined || s.titles !== undefined
                      ? tn("studio.check.lookingAt", images.length, { count: String(images.length) })
                      : tn("studio.check.workingOn", images.length, { count: String(images.length) })}
                  </p>
                )}
                {s.status === "waiting" && assistant && <p className="text-sm text-ink-secondary">{t("studio.check.waiting")}</p>}

                {titleChoices.length > 0 || s.titles || s.status === "done" ? (
                  <fieldset>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.check.titleLabel")}</legend>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {[...titleChoices, null].map((choice) => {
                        const on = (title[i] ?? null) === choice;
                        return (
                          <label
                            key={choice ?? "none"}
                            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-semibold ${
                              on ? "border-line-ink bg-action-strong text-on-action" : "border-line-strong bg-surface-raised text-ink-strong"
                            }`}
                          >
                            <input
                              type="radio"
                              name={`title-${day.slug}`}
                              className="sr-only"
                              checked={on}
                              onChange={() => setTitle((prev) => prev.map((v, at) => (at === i ? choice : v)))}
                            />
                            {choice ?? t("studio.check.noTitle")}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ) : null}

                {compare && showTidied && (
                  <div className="rounded-lg bg-surface-neutral px-3 py-2 text-sm leading-6 whitespace-pre-line text-ink-secondary">
                    <strong className="text-ink-body">{t("studio.check.before")}</strong> {own}
                  </div>
                )}
                <div
                  data-tidied={showTidied || undefined}
                  className={`text-base leading-7 whitespace-pre-line ${own.trim() ? "text-ink-body" : "italic text-ink-faint"} ${
                    showTidied ? "border-l-2 border-yellow-400 pl-3" : ""
                  }`}
                >
                  {text.trim() ? text : t("studio.check.noWords")}
                </div>
                {s.tidied && (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
                    <span className="flex-1">{keepMine[i] ? t("studio.check.yours") : t("studio.check.tidiedNote")}</span>
                    <button
                      type="button"
                      className="min-h-11 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-strong"
                      onClick={() => setKeepMine((prev) => prev.map((v, at) => (at === i ? !v : v)))}
                    >
                      {keepMine[i] ? t("studio.check.useTidied") : t("studio.check.keepMine")}
                    </button>
                  </div>
                )}
                {s.failure && (
                  <p className="text-sm text-ink-secondary">{t(s.failure)}</p>
                )}
                {s.captions && Object.keys(s.captions).length > 0 && (
                  <label className="flex min-h-11 items-center gap-3 text-sm text-ink-body">
                    <input
                      type="checkbox"
                      className="size-5"
                      checked={useCaptions[i]}
                      onChange={(e) => setUseCaptions((prev) => prev.map((v, at) => (at === i ? e.target.checked : v)))}
                    />
                    {tn("studio.check.captions", Object.keys(s.captions).length, { count: String(Object.keys(s.captions).length) })}
                  </label>
                )}
                {assistant && images.length > 0 && (
                  <details className="text-sm">
                    <summary className="min-h-11 cursor-pointer font-semibold text-ink-body underline underline-offset-2">
                      {t("studio.check.receiptAsk")}
                    </summary>
                    <ul className="mt-2 grid grid-cols-3 gap-2">
                      {images.map((p) => (
                        <li key={p.src} className="space-y-1">
                          <button type="button" onClick={() => void readReceipt(i, p.src)} className="block w-full overflow-hidden rounded-lg border border-line-quiet">
                            {/* eslint-disable-next-line @next/next/no-img-element -- a thumbnail to pick the receipt from. */}
                            <img src={`${p.src}?w=160`} alt={t("studio.check.receiptPick")} className="h-20 w-full object-cover" />
                          </button>
                          {receipts[p.src] && <p className="text-xs text-ink-secondary">{receipts[p.src]}</p>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
