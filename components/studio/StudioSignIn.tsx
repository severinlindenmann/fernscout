"use client";

import IdentitySignIn from "@/components/IdentitySignIn";

/**
 * B-2779 — the studio layout's one sign-in card. A reload re-renders the same
 * address, now with a session, so the person lands on the page they asked
 * for; there is no redirect target to sanitise.
 */
export default function StudioSignIn({ codeMinutes }: { codeMinutes: string }) {
  return <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.reload()} />;
}
