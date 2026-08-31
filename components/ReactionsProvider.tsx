"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  reactionKey,
  type DayCounts,
  type Reaction,
  type ReactionCounts,
} from "@/lib/reactionSet";

/** Identifies this browser to the reaction endpoint. A random id in
 * localStorage — not a fingerprint. See the note in DayReactions. */
const VOTER_KEY = "fs.voter";

type Ctx = {
  countsFor: (daySlug: string) => DayCounts;
  mineFor: (daySlug: string) => Reaction | null;
  react: (daySlug: string, emoji: Reaction) => void;
  /** False until the first load lands, so buttons can hold off. */
  ready: boolean;
};

const ReactionsContext = createContext<Ctx | null>(null);

function readVoterId(): string {
  let id = window.localStorage.getItem(VOTER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(VOTER_KEY, id);
  }
  return id;
}

/**
 * Loads every day's counts in one request rather than one per day. The story
 * shows a single day at a time, so per-day fetching would mean a round trip on
 * every Continue — and the whole payload is a few hundred bytes.
 *
 * Day slugs repeat across trips ("day-1" exists in every trip), so the maps
 * this keeps are indexed by the composite `<tripId>:<daySlug>` key rather
 * than the bare slug — built with `reactionKey` inside `countsFor`, `mineFor`
 * and `react`. `DayReactions` still passes a bare day slug; it doesn't need
 * to know trips exist.
 */
export default function ReactionsProvider({
  tripId,
  children,
}: {
  tripId: string;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState<ReactionCounts>({});
  const [mine, setMine] = useState<Record<string, Reaction>>({});
  const [ready, setReady] = useState(false);
  const [voterId, setVoterId] = useState<string | null>(null);

  useEffect(() => {
    const id = readVoterId();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVoterId(id);

    let cancelled = false;
    fetch(
      `/api/reactions?voter=${encodeURIComponent(id)}&trip=${encodeURIComponent(tripId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setCounts(data.counts ?? {});
        setMine(data.mine ?? {});
      })
      .catch(() => {
        // Offline or the API is down. The buttons stay usable and simply
        // don't have counts to show yet.
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [tripId]);

  const react = useCallback(
    (daySlug: string, emoji: Reaction) => {
      if (!voterId) return;
      const key = reactionKey(tripId, daySlug);

      const before = { counts, mine };
      const previous = mine[key] ?? null;
      const removing = previous === emoji;

      // Optimistic: the tap should register instantly even on a slow link.
      const dayCounts: DayCounts = { ...(counts[key] ?? {}) };
      if (previous)
        dayCounts[previous] = Math.max(0, (dayCounts[previous] ?? 1) - 1);
      if (!removing) dayCounts[emoji] = (dayCounts[emoji] ?? 0) + 1;

      setCounts({ ...counts, [key]: dayCounts });
      setMine((m) => {
        const next = { ...m };
        if (removing) delete next[key];
        else next[key] = emoji;
        return next;
      });

      fetch("/api/reactions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          day: daySlug,
          emoji,
          voter: voterId,
          trip: tripId,
        }),
      })
        .then((r) =>
          r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
        )
        .then((data: { counts: DayCounts; mine: Reaction | null }) => {
          // Reconcile with the server's tally, which includes everyone else.
          setCounts((c) => ({ ...c, [key]: data.counts }));
          setMine((m) => {
            const next = { ...m };
            if (data.mine) next[key] = data.mine;
            else delete next[key];
            return next;
          });
        })
        .catch(() => {
          setCounts(before.counts);
          setMine(before.mine);
        });
    },
    [counts, mine, voterId, tripId],
  );

  const value = useMemo<Ctx>(
    () => ({
      countsFor: (day) => counts[reactionKey(tripId, day)] ?? {},
      mineFor: (day) => mine[reactionKey(tripId, day)] ?? null,
      react,
      ready,
    }),
    [counts, mine, react, ready, tripId],
  );

  return (
    <ReactionsContext.Provider value={value}>
      {children}
    </ReactionsContext.Provider>
  );
}

export function useReactions() {
  return useContext(ReactionsContext);
}
