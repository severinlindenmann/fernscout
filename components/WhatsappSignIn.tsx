"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

const POLL_MS = 2000;

/**
 * Signing in by sending a WhatsApp message (B-3003): one waiting screen for
 * every door (`/me/wa` for the instance-wide and journal sign-in, the welcome
 * guide's own step route). It asks the endpoint for a wa.me link on mount,
 * shows it, and asks every two seconds whether the message has arrived.
 * `onIn` runs once the server has set the session cookie.
 */
export default function WhatsappSignIn({
  endpoint,
  startBody,
  pollAction,
  number,
  onIn,
  onBack,
  linkClassName,
  backClassName,
}: {
  endpoint: string;
  startBody: Record<string, unknown>;
  pollAction: string;
  /** The number the message must come from, as the person should read it. */
  number: string;
  onIn: () => void;
  onBack: () => void;
  linkClassName: string;
  backClassName: string;
}) {
  const { t } = useI18n();
  const [started, setStarted] = useState<{ id: string; link: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(false);

  const post = (body: Record<string, unknown>) =>
    fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    post(startBody)
      .then(async (response) => {
        const json = (await response.json().catch(() => ({}))) as { id?: string; link?: string };
        if (response.ok && json.id && json.link) setStarted({ id: json.id, link: json.link });
        else setProblem(t(response.status === 400 ? "me.signInPhoneBad" : "me.signInPhoneUnavailable"));
      })
      .catch(() => setProblem(t("me.signInPhoneUnavailable")));
    // Once per mount; the parent remounts it to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const id = started?.id;
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await post({ action: pollAction, id });
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (stopped) return;
        const state = String(json.status ?? "");
        if (response.ok && json.ok === true && state === "in") {
          clearInterval(timer);
          onIn();
        } else if (state === "mismatch") {
          clearInterval(timer);
          setStarted(null);
          setProblem(t("join.wa.mismatch"));
        } else if (state === "expired" || response.status === 404) {
          clearInterval(timer);
          setStarted(null);
          setProblem(t("join.wa.expired"));
        }
      } catch {
        // A dropped request: the next tick asks again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // `post`, `onIn` and `t` close over nothing this poll must restart on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return (
    <div className="mt-2">
      <p className="text-base leading-7 text-ink-body">{t("join.wa.body")}</p>
      {started && (
        <>
          <a href={started.link} target="_blank" rel="noopener noreferrer" className={`${linkClassName} text-center`}>
            {t("join.wa.open")}
          </a>
          <p role="status" className="mt-3 text-base font-semibold text-ink-strong">
            {t("join.wa.waiting")}
          </p>
          <p className="text-sm text-ink-secondary">{t("join.wa.from", { number })}</p>
        </>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-base text-coral-600">
          {problem}
        </p>
      )}
      <button type="button" className={backClassName} onClick={onBack}>
        {t("join.code.another")}
      </button>
    </div>
  );
}
