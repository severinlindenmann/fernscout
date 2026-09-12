/**
 * What `?c=` and `?about=` together decide — pulled out of the page so it is
 * checkable without rendering one, B1242.
 *
 * `about` alone (B994, a link from a day) starts fresh: `forget` and a note.
 * `c` alone (B1168, reopening from history or a WhatsApp turn's own link)
 * adopts that session as it stands. **Both together** — the shape the
 * WhatsApp preview link carries since B1242, naming the conversation a
 * press already happened in *and* the day that press was about — adopts the
 * session and still opens the preview on that day; forgetting it to show
 * the preview would be losing the very conversation the link is for.
 */
export function arrivalFor(asked: {
  c?: string;
  about?: string;
}): { opening: { trip: string; slug: string } | null; named: string; shouldForget: boolean } {
  const [aboutTrip, aboutSlug] = (asked.about ?? "").split("/");
  const opening = aboutTrip && aboutSlug ? { trip: aboutTrip, slug: aboutSlug } : null;
  const named = asked.c ?? "";
  return { opening, named, shouldForget: opening !== null && named === "" };
}

/**
 * Whether the door should ask for the identity this browser has already
 * earned — B1492. Kept outside the App Router page so the rule is checkable
 * without adding an unsupported named export to a Next.js entry module.
 */
export function shouldUpgradeIdentity(identity: unknown, journalCookie: string | undefined): boolean {
  return !identity && Boolean(journalCookie);
}
