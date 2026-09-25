"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Ask the server for the identity this reader would have if they signed in
 * today — B459, and see the route for why a journal session earns one.
 *
 * Rendered by the journal layout for exactly one reader: the one holding
 * `fs_session` for this journal and no `fs_identity`. A stranger renders
 * nothing and fetches nothing, and once the cookie exists the condition is
 * false and this component is gone — so it is one request, once, per browser
 * that predates B410.
 *
 * `router.refresh()` rather than leaving it until the next navigation: what
 * the identity buys is drawn in the header of the page they are already
 * looking at, and a way out that appears when you happen to click something
 * else is not much of a way out.
 */
export default function IdentityUpgrade() {
  const router = useRouter();

  useEffect(() => {
    let live = true;
    fetch("/api/auth/identity/upgrade", { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (live && body?.issued) router.refresh();
      })
      // Nothing to say and nothing to retry. The reader keeps the journal they
      // are reading; only the way out of it stays hidden until next time.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [router]);

  return null;
}
