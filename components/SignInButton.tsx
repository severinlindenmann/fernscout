"use client";

import { useState } from "react";

/**
 * The one press that spends a sign-in link (B142).
 *
 * A button rather than a redirect, because a link in an email is followed by
 * machines before it is followed by the person it was sent to — a scanner at
 * the receiving mail host swept three welcome links twelve seconds apart on
 * the live instance and spent all three. Scanners follow links; they do not
 * submit forms.
 *
 * Written for the same reader as `ContactForm`: one control, 48px tall, no
 * account and no password. The failure text is the interesting part — somebody
 * whose link has already been spent did nothing wrong, and the copy has to say
 * so rather than implying they were slow.
 */
export default function SignInButton({
  username,
  token,
  label,
  working,
  failed,
}: {
  /**
   * The journal this link signs somebody into, or absent for an instance-wide
   * identity link — B430.
   *
   * One component rather than two, because the difference is an endpoint and a
   * fallback path; everything that makes this file worth reading — the button
   * instead of a redirect, the copy when a link has already been spent — is
   * identical for both and would have been copied wrongly into the second one.
   */
  username?: string;
  token: string;
  label: string;
  working: string;
  failed: string;
}) {
  const [state, setState] = useState<"idle" | "working" | "failed">("idle");

  async function open() {
    setState("working");
    const response = await fetch(
      username ? "/api/auth/link" : "/api/auth/identity/link",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(username ? { user: username, token } : { token }),
      },
    ).catch(() => null);

    const body = (await response?.json().catch(() => null)) as { next?: string } | null;
    if (!response?.ok) {
      // The server names where to go next — the page that can issue a fresh
      // code. Falling back here rather than guessing keeps the two in step.
      if (body?.next) {
        window.location.href = body.next;
        return;
      }
      setState("failed");
      return;
    }

    window.location.href = body?.next ?? (username ? `/${username}` : "/");
  }

  return (
    <div className="mt-9">
      <button
        type="button"
        onClick={open}
        disabled={state === "working"}
        className="inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-60"
      >
        {state === "working" ? working : label}
      </button>
      {state === "failed" && (
        <p className="mt-4 text-xl leading-8 text-navy-700">{failed}</p>
      )}
    </div>
  );
}
