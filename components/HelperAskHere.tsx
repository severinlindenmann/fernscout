"use client";

import { useEffect, useState } from "react";
import HelperAsk from "./HelperAsk";

/** What `GET /api/helper/<user>/ask` answers an owner with. */
type Config = {
  consented: boolean;
  speech: boolean;
  consentedSpeech: boolean;
  speechProvider: string;
};

/**
 * The ask box, on the journal's own pages — B844.
 *
 * B685 built the router, B817 taught it to refuse safely and B783 gave it a
 * real read row, and every one of them landed on `/agent` — a page an owner
 * who has published a journal has no reason to open. A returning owner did
 * all six of her tasks from the day, the trip and the story, and reported
 * that there was no request box. She was right, and nothing was broken: it
 * was three clicks away from every page she used.
 *
 * **It asks the server whether it belongs here**, the same shape
 * `InviteToRead` has beside it, and for the same reason: a 404 is "not your
 * journal, or the helper is off here", and the honest answer to that is to
 * draw nothing rather than a box that explains itself after being pressed.
 * The call site is already inside an owner-only branch (`canPublish`, which
 * is exactly `isOwner`), so this is the second half of the gate and not the
 * first — a reader never renders it and, if one somehow did, gets a 404.
 *
 * The five props `HelperAsk` needs are read on the server everywhere else.
 * Here they cannot be: a day card is several client components below a page
 * that knows nothing about the helper, and threading a capability through
 * `TripStory` and `StoryPager` would put it in the props of every page that
 * renders a day.
 */
export default function HelperAskHere({ username }: { username: string }) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/helper/${encodeURIComponent(username)}/ask`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: Config | null) => {
        if (!cancelled && body) setConfig(body);
      })
      .catch(() => {
        // A journal that cannot answer shows nothing. The page is a travel
        // journal first, and this is an accelerator over controls that work.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!config) return null;
  return (
    <HelperAsk
      username={username}
      consented={config.consented}
      speech={config.speech}
      consentedSpeech={config.consentedSpeech}
      speechProvider={config.speechProvider}
      onJournal
    />
  );
}
