"use client";

import { useState } from "react";
import CopyLine from "./CopyLine";
import { useI18n } from "./LocaleProvider";
import { handoverPrompt } from "@/lib/api/agentCopy";

/**
 * What an owner hands to an agent.
 *
 * There is no form on this site (ROADMAP decision 24, as amended by B283), so
 * this block *is* the interface for writing. It lived in one place — the owner
 * panel on `/<user>/me` — which is a page a new owner has no reason to have
 * visited; B76 needed the same block on the empty trip list. Extracted rather
 * than copied, because two copies of an instruction is one instruction and one
 * stale instruction. **Both call sites gate it on the viewer being the owner**,
 * and after B283 that is load-bearing rather than merely tidy: the button
 * below mints a credential.
 *
 * ## What it used to be, and why that was not enough
 *
 * Two lines and a promise: the guide's URL, the owner's address, and the
 * expectation that the agent would ask for a six-digit code which the owner
 * would then read out. Everything after "hand these two lines over" happened
 * somewhere this page could not see, and the step in the middle was a person
 * reading digits off a phone to a laptop.
 *
 * B283 replaced it with one button and a pasteable prompt: a twenty-minute
 * key, the call that turns it into the agent's own seven-day token, and the
 * instruction to read `/status` before writing anything. It kept the two
 * lines visible underneath — on the reasoning that nothing about the code
 * flow had been removed, so why not offer it — which left the page presenting
 * two ways to do the same job to a reader with no basis for choosing between
 * them. B301 removed the two lines. The code flow itself
 * (`POST /api/auth/request` / `/verify`) is unchanged and still documented at
 * `/agent.md`; this page just no longer offers it beside the button.
 *
 * ## Why the key is not printed until it is asked for
 *
 * A credential minted on page load is a row in `sessions` for every visit to
 * this page, most of which are not somebody about to start an agent. It also
 * puts a live credential on screen behind whoever walks past. So: press the
 * button, and it appears with its expiry beside it.
 *
 * Draws no outer margin: the caller decides where it sits.
 */
export default function AgentHandover({
  username,
  siteUrl,
  onIssued,
}: {
  /** Whose journal, for the exchange URL in the prompt. */
  username: string;
  /** This instance's public base URL, from server config. */
  siteUrl: string;
  /** Called when a key has just been created, so the list of live keys beside
   * this block reads itself again — see `AgentKeys`. */
  onIssued?: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function mint() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/v1/${username}/handover`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }).catch(() => null);
    setBusy(false);

    if (!response?.ok) {
      setFailed(true);
      return;
    }
    const body = (await response.json()) as {
      handover?: string;
      expiresAt?: string;
      minutes?: number;
    };
    if (!body.handover) {
      setFailed(true);
      return;
    }
    setPrompt(
      handoverPrompt({
        siteUrl,
        username,
        handover: body.handover,
        minutes: body.minutes ?? 20,
      }),
    );
    setExpires(body.expiresAt ?? null);
    onIssued?.();
  }

  return (
    <div>
      <h3 className="font-display text-base font-semibold text-navy-900">{t("me.agentTitle")}</h3>
      <p className="mt-1 text-base leading-7 text-navy-700">{t("me.agentBody")}</p>

      {prompt === null ? (
        <>
          <button
            type="button"
            onClick={mint}
            disabled={busy}
            className="mt-3 inline-flex min-h-11 items-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {busy ? t("me.handoverWorking") : t("me.handoverCreate")}
          </button>
          {failed && (
            <p role="alert" className="mt-3 text-base leading-7 text-coral-600">
              {t("me.handoverFailed")}
            </p>
          )}
        </>
      ) : (
        <HandoverPrompt prompt={prompt} expires={expires} />
      )}
    </div>
  );
}

/**
 * The minted prompt, split out from `AgentHandover` so this half — the one
 * that copies a live credential — renders (and can be exercised in a test)
 * from its own props rather than only being reachable by clicking the button
 * above, which a static render can never do.
 */
export function HandoverPrompt({ prompt, expires }: { prompt: string; expires: string | null }) {
  const { t } = useI18n();
  return (
    <div className="mt-3">
      <p className="text-base leading-7 text-navy-900">
        {t("me.handoverReady", {
          time: expires ? new Date(expires).toLocaleTimeString() : "",
        })}
      </p>
      {/*
        Shown as text, not hidden behind the copy button, because a person
        handing over a credential is entitled to see what they are handing
        over — and because the clipboard fails silently often enough that a
        block you cannot read is a block you cannot recover.
      */}
      <pre className="mt-3 max-h-64 overflow-auto rounded-xl bg-cream-100 p-3 text-xs leading-6 text-navy-900">
        {prompt}
      </pre>
      <div className="mt-3">
        {/* The prompt is multi-line and contains a live credential, so its
            accessible name says what the button does rather than reciting the
            value — the same rule B199 found broken for the old two-line
            block, and here the stakes are a credential rather than two public
            addresses. */}
        <CopyLine
          value={prompt}
          label={t("me.handoverCopy")}
          copiedLabel={t("landing.copied")}
          name={t("me.handoverCopy")}
        />
      </div>
      <p className="mt-3 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
        {t("me.handoverWarning")}
      </p>
    </div>
  );
}
