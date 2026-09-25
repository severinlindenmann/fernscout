"use client";

import { useState } from "react";
import { ChevronRight, TriangleAlert } from "lucide-react";
import AgentHandover from "@/components/AgentHandover";
import AgentKeys from "@/components/AgentKeys";
import { useI18n } from "@/components/LocaleProvider";
import SubmitError from "@/components/studio/SubmitError";
import type { TranslationKey } from "@/lib/i18n";

/** A consent scope as `lib/helper/consent.ts` names it — kept as a plain
 *  union here because that module is server-only. */
type Scope = "words" | "photos" | "speech" | "statement" | "sessions";

/**
 * One switch row. `granted` lists the scopes this row stands for that are on
 * right now — the words row stands for `words` and `statement`, which go to
 * the same recipient (`currentHelperProvider`), so it is on when either is and
 * switching it off withdraws both.
 */
export type PermissionRow = {
  id: "words" | "speech" | "photos" | "sessions";
  granted: Scope[];
  /** Who it goes to, today — named in the row's sentence. */
  provider: string;
};

const ROW_TEXT: Record<PermissionRow["id"], { title: TranslationKey; body: TranslationKey }> = {
  words: { title: "studio.permissions.words.title", body: "studio.permissions.words.body" },
  speech: { title: "studio.permissions.speech.title", body: "studio.permissions.speech.body" },
  photos: { title: "studio.permissions.photos.title", body: "studio.permissions.photos.body" },
  sessions: { title: "studio.permissions.sessions.title", body: "studio.permissions.sessions.body" },
};

/**
 * `/[user]/studio/agent` — "Permissions & keys" (B2142, after B2017/B2091).
 *
 * Two things on this page are still real after the web agent retired: what
 * leaves this server (the consents the studio's imports ask for), and the
 * writing keys an outside agent uses through the API.
 *
 * **What leaves this server** is four switches in the journal-settings style.
 * `sessions` flips both ways here (it starts on, and says nothing leaves).
 * The three that send something to a model or a transcriber can only be
 * switched **off** here: an import asks for them with its own full panel
 * (B684), and a one-line row is not that panel — so an ungranted one is a
 * disabled switch that says the import asks when it needs it. Every write
 * goes through the existing `/api/helper/{user}/consent` route.
 *
 * **Keys** is collapsed by default: the handover button, the live keys with
 * Revoke (which asks first, `AgentKeys`), and "What the agent gets".
 */
export default function AgentPageContent({
  username,
  permissions: initial,
}: {
  username: string;
  permissions: PermissionRow[];
}) {
  const { t } = useI18n();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<PermissionRow["id"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped when the handover block mints a key, so the list of live keys below
  // it reads itself again rather than showing the state from page load.
  const [keysChanged, setKeysChanged] = useState(0);

  async function flip(row: PermissionRow) {
    const on = row.granted.length > 0;
    // Only `sessions` can be granted from here — see the module comment.
    if (!on && row.id !== "sessions") return;
    setBusy(row.id);
    setError(null);
    const scopes: Scope[] = on ? row.granted : ["sessions"];
    let ok = true;
    for (const scope of scopes) {
      const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
        method: on ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      }).catch(() => null);
      if (!response?.ok) {
        ok = false;
        break;
      }
    }
    if (ok) setRows((prior) => prior.map((r) => (r.id === row.id ? { ...r, granted: on ? [] : ["sessions"] } : r)));
    else setError(t("studio.permissions.failed"));
    setBusy(null);
  }

  return (
    <>
      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.permissions.leavesTitle")}</h2>
        <ul data-permissions className="mt-3 space-y-2">
          {rows.map((row) => {
            const on = row.granted.length > 0;
            const locked = !on && row.id !== "sessions";
            const labelId = `${username}-permission-${row.id}`;
            return (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-2xl border border-line-strong bg-surface-raised px-4 py-3"
              >
                <span className="min-w-0 flex-1" id={labelId}>
                  <span className="block text-base font-semibold text-ink-strong">{t(ROW_TEXT[row.id].title)}</span>
                  <span className="mt-0.5 block text-sm leading-6 text-ink-secondary">
                    {t(ROW_TEXT[row.id].body, { provider: row.provider })}
                    {locked && <> {t("studio.permissions.asksWhenNeeded")}</>}
                  </span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-labelledby={labelId}
                  disabled={locked || busy === row.id}
                  onClick={() => void flip(row)}
                  className={`relative h-7 w-12 flex-none rounded-full transition-colors disabled:opacity-50 ${on ? "bg-action-strong" : "bg-line-prominent"}`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute top-1 size-5 rounded-full bg-surface-raised transition-all ${on ? "left-6" : "left-1"}`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <SubmitError message={error} />
      </section>

      <details data-keys className="mt-8 border-t border-line-quiet pt-5">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-display text-lg font-semibold text-ink-strong [&::-webkit-details-marker]:hidden">
          <ChevronRight
            className="h-4 w-4 shrink-0 text-ink-secondary transition-transform [details[open]>summary>&]:rotate-90"
            aria-hidden="true"
          />
          {t("studio.permissions.keysTitle")}
        </summary>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("studio.permissions.keysLede")}</p>

        <AgentHandover username={username} intro={false} onIssued={() => setKeysChanged((n) => n + 1)} />

        {/* The way to take a key back — B283. Renders nothing until there is
            a live key; Revoke asks first (B2091). */}
        <AgentKeys username={username} reloadOn={keysChanged} />

        <details className="mt-5">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 font-display text-base font-semibold text-ink-strong [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="h-4 w-4 shrink-0 text-ink-secondary transition-transform [details[open]>summary>&]:rotate-90"
              aria-hidden="true"
            />
            {t("me.tokenTitle")}
          </summary>
          <p className="mt-1.5 text-base leading-7 text-ink-body">{t("me.tokenBody")}</p>
          <div className="mt-3 flex gap-3 rounded-xl border border-coral-300 bg-coral-300/15 p-3.5">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] shrink-0 text-coral-600" aria-hidden="true" />
            <p className="text-base leading-7 text-ink-strong">{t("me.tokenWarning")}</p>
          </div>
        </details>
      </details>
    </>
  );
}
