"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The last press.
 *
 * A button, not a link, and a POST, not a GET — the whole point of the page
 * this sits on. A mail scanner that follows the link in the confirmation mail
 * renders this component and nothing happens; deletion needs somebody to press
 * it. See the route handler for the two places this repository has already
 * reasoned about GETs that change things.
 *
 * The destructive action is styled as the *quiet* one and "keep it" carries
 * the yellow, which inverts the usual hierarchy on purpose: on this page the
 * safe answer should be the one your thumb lands on.
 */
export default function DeleteConfirm({
  endpoint,
  keepHref,
  labels,
}: {
  endpoint: string;
  keepHref: string;
  labels: {
    remove: string;
    working: string;
    keep: string;
    failed: string;
    doneTitle: string;
    doneBody: string;
  };
}) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  async function remove() {
    setState("working");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      setState(response.ok ? "done" : "failed");
    } catch {
      setState("failed");
    }
  }

  if (state === "done") {
    return (
      <div role="status" className="mt-10 rounded-2xl border border-navy-200 bg-white p-6">
        <h2 className="font-display text-2xl font-semibold text-navy-900">{labels.doneTitle}</h2>
        <p className="mt-3 text-lg leading-8 text-navy-700">{labels.doneBody}</p>
      </div>
    );
  }

  return (
    <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center">
      <Link
        href={keepHref}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
      >
        {labels.keep}
      </Link>
      <button
        type="button"
        onClick={remove}
        disabled={state === "working"}
        className="inline-flex min-h-12 items-center justify-center rounded-full border border-coral-600 px-6 text-lg font-semibold text-coral-600 transition-colors hover:bg-coral-600 hover:text-white disabled:opacity-60"
      >
        {state === "working" ? labels.working : labels.remove}
      </button>
      {state === "failed" && (
        <p role="alert" className="text-lg leading-8 text-coral-600">
          {labels.failed}
        </p>
      )}
    </div>
  );
}
