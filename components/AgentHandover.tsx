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
 * Now it is one button and a pasteable prompt: a twenty-minute key, the call
 * that turns it into the agent's own seven-day token, and the instruction to
 * read `/status` before writing anything. The two lines are still there for
 * anybody who would rather do it the old way — nothing about the code flow was
 * removed.
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
  docUrl,
  /** The owner's own address — never rendered for anybody else. */
  email,
  username,
  siteUrl,
  onIssued,
}: {
  docUrl: string;
  email: string | null;
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
          {/*
            The old way, still here and still true. Somebody who does not want
            to put a key on their clipboard — or whose agent cannot make an
            HTTP call of its own — hands over these two lines and reads out a
            code, exactly as before.
          */}
          <p className="mt-4 text-base leading-7 text-navy-700">{t("me.agentByHand")}</p>
          <p className="mt-2 font-mono text-sm text-navy-900">{docUrl}</p>
          <p className="font-mono text-sm text-navy-600">{email}</p>
          <div className="mt-3">
            {/* One control, two values, and therefore an accessible name that
                says what it copies rather than reciting it. Reciting put the
                guide's address and the owner's own address into one run of text
                separated by a newline, which readers announce inconsistently or
                not at all — one string where there were two, under a name that
                said "Copy link". B199. Both lines are above as page text. */}
            <CopyLine
              value={[docUrl, email].filter(Boolean).join("\n")}
              label={t("landing.copy")}
              copiedLabel={t("landing.copied")}
              name={t("me.agentCopy")}
            />
          </div>
        </>
      ) : (
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
            <CopyLine
              value={prompt}
              label={t("me.handoverCopy")}
              copiedLabel={t("landing.copied")}
              // Never the value: it contains a live credential, and B199's rule
              // about not reciting multi-line values applies twice over here.
              name={t("me.handoverCopy")}
            />
          </div>
          <p className="mt-3 border-l-2 border-coral-600 pl-3 text-base leading-7 text-navy-900">
            {t("me.handoverWarning")}
          </p>
        </div>
      )}
    </div>
  );
}
