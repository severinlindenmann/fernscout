"use client";

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import { splitIntoParts } from "@/lib/studio/dayParts";
import { photosInGroup } from "@/lib/studio/dayCards";
import AddDayFlow from "./AddDayFlow";
import DayCheck from "./DayCheck";
import type { InboxMediaItem } from "./types";

/**
 * Add a day, start to finish — TIX-2.
 *
 * The steps around the composer the studio already had (`AddDayFlow`, which
 * keeps every one of its own rules: photos, date and place, the offline
 * outbox, a second entry on one date):
 *
 * 1. **With or without the assistant**, asked once and remembered, with its
 *    consent the first time it is chosen.
 * 2. **Split**: a waiting day whose photographs fall into parts hours and
 *    kilometres apart is offered as that many entries — offered, never imposed.
 * 3. **One part at a time**: each is the composer, limited to its photos and
 *    starting at its first photo's time, saved as a private draft on "Next".
 * 4. **Check your day** (`DayCheck`): every part as readers will see it, the
 *    assistant's suggestions shown and applied only on "Looks good".
 * 5. **Share**: the publish step, with every part and who is told.
 */

type Assistant = "on" | "off";
type Saved = { slug: string; trip: string; date: string };

const PRIMARY =
  "min-h-11 flex-1 rounded-full bg-action-strong px-4 text-base font-semibold text-on-action disabled:opacity-50";
const SECONDARY =
  "min-h-11 rounded-full border border-line-strong px-4 text-base font-semibold text-ink-strong hover:bg-surface-subtle";

export default function DayFlow(
  props: ComponentProps<typeof AddDayFlow> & {
    /** The owner's remembered answer, `null` when never asked. */
    assistantChoice: Assistant | null;
    /** Whether an assistant exists here at all: the helper or transcription
     *  capability. Without either, the flow never asks. */
    assistantPossible: boolean;
    /** Consents already given, and to whom each scope's data goes. */
    consents: { words: boolean; photos: boolean; speech: boolean };
    providers: { words: string; speech: string | null };
    /** The helper capability — tidying, titles, captions, receipts. */
    helperOn: boolean;
    /** B2649 — the plan's AI-days counter, shown in the assistant's row. */
    aiDays?: ReactNode;
  },
) {
  const { assistantChoice, assistantPossible, consents, providers, helperOn, aiDays = null, ...composer } = props;
  const { t, tn } = useI18n();
  const router = useRouter();
  const [assistant, setAssistant] = useState<Assistant | null>(assistantPossible ? assistantChoice : "off");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inbox, setInbox] = useState<InboxMediaItem[] | null>(null);
  const [split, setSplit] = useState<boolean | null>(null);
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [checking, setChecking] = useState(false);
  const [choiceFailed, setChoiceFailed] = useState(false);
  const user = encodeURIComponent(composer.username);

  // A waiting day's photographs, to see whether they fall into parts.
  useEffect(() => {
    if (!composer.initialPhotos) return;
    fetch(`/api/helper/${user}/inbox`)
      .then((r) => r.json())
      .then((json: { media?: InboxMediaItem[] }) => setInbox(json.media ?? []))
      .catch(() => setInbox([]));
  }, [user, composer.initialPhotos]);

  const parts = useMemo(() => {
    if (!composer.initialPhotos || !inbox) return [];
    const photos = photosInGroup(inbox, composer.initialPhotos);
    return splitIntoParts(photos.map((p) => ({ id: p.id, takenAt: p.takenAt, lat: p.lat, lon: p.lon }))).parts;
  }, [inbox, composer.initialPhotos]);
  const offerSplit = parts.length >= 2 && split === null;
  const usingParts = split === true && parts.length >= 2;
  const total = usingParts ? parts.length : 1;

  async function choose(next: Assistant) {
    setBusy(true);
    // no-refresh: the choice only steers this flow; nothing on the page reads it.
    const response = await fetch(`/api/web/${user}/studio/assistant`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assistant: next }),
    }).catch(() => null);
    setBusy(false);
    // B2649 — a choice that did not save is not shown as made.
    setChoiceFailed(!response?.ok);
    if (!response?.ok) return;
    setAssistant(next);
    setAsking(false);
  }

  async function agree() {
    setBusy(true);
    const scopes = [
      ...(helperOn && !consents.words ? ["words"] : []),
      ...(helperOn && !consents.photos ? ["photos"] : []),
      ...(providers.speech && !consents.speech ? ["speech"] : []),
    ];
    for (const scope of scopes) {
      // no-refresh: consent is read again by every route that needs it.
      await fetch(`/api/helper/${user}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      }).catch(() => null);
    }
    await choose("on");
  }

  const missingConsent =
    (helperOn && (!consents.words || !consents.photos)) || (providers.speech !== null && !consents.speech);
  const choosing = assistant === null;

  if (checking) {
    return <DayCheck username={composer.username} saved={saved} assistant={assistant === "on" && helperOn} />;
  }

  if (choosing) {
    return (
      <div className="mt-2 space-y-4">
        <Bar>
          <div className="flex w-full gap-2">
            <button type="button" className={SECONDARY} disabled={busy} onClick={() => void choose("off")}>
              {t("studio.flow.without")}
            </button>
            <BusyButton
              busy={busy}
              type="button"
              className={PRIMARY}
              onClick={() => (asking ? void agree() : missingConsent ? setAsking(true) : void choose("on"))}
            >
              {asking ? t("studio.flow.consentAgree") : t("studio.flow.with")}
            </BusyButton>
          </div>
        </Bar>
        {aiDays && <div className="flex flex-wrap items-center">{aiDays}</div>}
        <div className="rounded-2xl bg-surface-subtle px-4 py-3 text-sm leading-6 text-ink-body">
          <p className="font-semibold text-ink-strong">{t("studio.flow.hintTitle")}</p>
          <p>{t("studio.flow.hintBody")}</p>
        </div>
        {asking && (
          <div role="region" aria-labelledby="assistant-consent" className="rounded-2xl border border-line-strong bg-surface-raised p-4 text-sm leading-6 text-ink-body">
            <h2 id="assistant-consent" className="font-semibold text-ink-strong">
              {t("studio.flow.consentTitle")}
            </h2>
            <p className="mt-2">
              {providers.speech
                ? t("studio.flow.consentBody", { words: providers.words, speech: providers.speech })
                : t("studio.flow.consentBodyNoSpeech", { words: providers.words })}
            </p>
            <a href="/legal#ai" className="mt-2 inline-block min-h-11 font-semibold text-ink-strong underline underline-offset-2">
              {t("studio.flow.consentLink")}
            </a>
            <p className="text-xs text-ink-secondary">{t("studio.flow.consentOnce")}</p>
          </div>
        )}
      </div>
    );
  }

  if (offerSplit) {
    const range = (p: (typeof parts)[number]) => [p.from, p.to].filter(Boolean).join("–");
    return (
      <div className="mt-2 rounded-2xl border border-line-strong bg-surface-raised p-4">
        <Bar>
          <div className="flex w-full gap-2">
            <button type="button" className={SECONDARY} onClick={() => setSplit(false)}>
              {t("studio.flow.splitNo")}
            </button>
            <button type="button" className={PRIMARY} onClick={() => setSplit(true)}>
              {tn("studio.flow.splitYes", parts.length, { count: String(parts.length) })}
            </button>
          </div>
        </Bar>
        <h2 className="font-display text-lg font-semibold text-ink-strong">
          {tn("studio.flow.splitTitle", parts.length, { count: String(parts.length) })}
        </h2>
        <ol className="mt-2 space-y-1 text-sm text-ink-body">
          {parts.map((p, i) => (
            <li key={i}>
              {tn("studio.flow.partLine", p.ids.length, { index: String(i + 1), range: range(p) || "—", count: String(p.ids.length) })}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-secondary">{t("studio.flow.splitWhy")}</p>
      </div>
    );
  }

  const part = usingParts ? parts[index] : null;
  return (
    <>
      {(assistantPossible || aiDays) && (
        <div data-assistant-row className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {assistantPossible && (
            <button
              type="button"
              role="switch"
              aria-checked={assistant === "on"}
              disabled={busy}
              onClick={() => (assistant === "on" ? void choose("off") : missingConsent ? setAssistant(null) : void choose("on"))}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm font-semibold ${
                assistant === "on" ? "border-emerald-600/40 bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100" : "border-line-strong bg-surface-raised text-ink-secondary"
              }`}
            >
              <span aria-hidden className={`size-2.5 rounded-full ${assistant === "on" ? "bg-emerald-500 ring-4 ring-emerald-500/20" : "bg-ink-faint"}`} />
              {t("studio.flow.switchLabel")} · {assistant === "on" ? t("studio.flow.switchOn") : t("studio.flow.switchOff")}
            </button>
          )}
          {aiDays}
          {choiceFailed && (
            <p role="alert" className="w-full basis-full text-sm text-coral-600">
              {t("studio.flow.choiceFailed")}
            </p>
          )}
        </div>
      )}
      {usingParts && (
        <ol aria-label={t("studio.flow.partsLabel")} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {parts.map((p, i) => (
            <li
              key={i}
              aria-current={i === index ? "step" : undefined}
              className={`rounded-xl border px-3 py-2 text-xs ${
                i === index ? "border-line-ink bg-surface-raised font-semibold text-ink-strong" : "border-line-quiet text-ink-secondary"
              }`}
            >
              {i < saved.length ? "✓ " : ""}
              {t("studio.flow.partHeading", { index: String(i + 1), total: String(total) })}
              {p.from ? ` · ${p.from}` : ""}
            </li>
          ))}
        </ol>
      )}
      <AddDayFlow
        key={usingParts ? `part-${index}` : "one"}
        {...composer}
        asPart={{
          key: usingParts ? `part-${index}` : "one",
          photoIds: part ? part.ids : null,
          time: part?.from ?? "",
          secondEntry: usingParts && index > 0,
          label: usingParts && index < total - 1 ? t("studio.flow.next") : t("studio.flow.check"),
          assistant: assistant === "on",
          onSaved: (day) => {
            setSaved((prev) => [...prev, day]);
            if (usingParts && index < total - 1) setIndex(index + 1);
            else {
              setChecking(true);
              router.refresh();
            }
          },
        }}
      />
    </>
  );
}

/** The bottom bar for this flow's own two screens — mounted only there, so it
 *  never competes with the composer's own Save button for the one bar. */
function Bar({ children }: { children: ReactNode }) {
  useStudioBar(children, { replace: true, desktop: true });
  return null;
}
