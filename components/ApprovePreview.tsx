"use client";

import { useEffect, useState } from "react";
import ApproveButton from "@/components/ApproveButton";
import { useI18n } from "./LocaleProvider";

/**
 * Turns the approval page's URL fragment into "approve N credits?" — B1635.
 *
 * The token used to be the page's own path segment, which a browser sends to
 * the server on every request: it reached the access log, any proxy log in
 * front of it, and the `Referer` header of anything the page went on to load.
 * It now lives in `location.hash`, which a browser keeps to itself and never
 * sends anywhere — so this component, not the server component around it, is
 * the only thing that ever reads it, and it hands the token onward only in a
 * request body (the preview call here, and `ApproveButton`'s own approve
 * call, B1636).
 */
type State =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "ready"; token: string; credits: number; amount: string };

export default function ApprovePreview({
  username,
  paymentId,
}: {
  username: string;
  paymentId: string;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    // The whole body runs from a resolved promise, never straight off the
    // effect's own call stack — react-hooks/set-state-in-effect flags a
    // setState reachable synchronously from the effect body itself (the
    // "invalid" case here would otherwise be one), so this reads
    // `location.hash` from inside the same async continuation the fetch
    // below already had to use.
    Promise.resolve().then(async () => {
      const match = /(?:^#|[#&])token=([^&]*)/.exec(window.location.hash);
      const token = match ? decodeURIComponent(match[1]) : "";
      if (!token) {
        if (!cancelled) setState({ status: "invalid" });
        return;
      }

      const data = await fetch(`/api/web/${username}/purchases/${paymentId}/approve/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .catch(() => null) as { credits: number; amount: string } | null;

      if (cancelled) return;
      if (!data) {
        setState({ status: "invalid" });
        return;
      }
      setState({ status: "ready", token, credits: data.credits, amount: data.amount });
    });

    return () => {
      cancelled = true;
    };
  }, [username, paymentId]);

  if (state.status === "loading") {
    return <p className="text-lg leading-8 text-ink-strong">{t("approve.loading")}</p>;
  }
  if (state.status === "invalid") {
    return (
      <p role="alert" className="text-lg leading-8 text-ink-strong">
        {t("approve.invalid")}
      </p>
    );
  }
  return (
    <ApproveButton
      username={username}
      paymentId={paymentId}
      token={state.token}
      credits={state.credits}
      amount={state.amount}
    />
  );
}
