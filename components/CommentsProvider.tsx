"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type DayComment = {
  id: string;
  /** The display name the guest was invited under, never an email address. */
  author: string;
  body: string;
  /** ISO timestamp. */
  at: string;
  edited?: boolean;
  /** Decided by the server for the signed-in viewer. */
  mine: boolean;
};

export type DayState = {
  /** `hidden`: the server gave this viewer nothing (flag off, not invited). */
  status: "loading" | "ready" | "hidden" | "offline";
  comments: DayComment[];
  total: number;
  isOwner: boolean;
  maxLength: number;
};

const INITIAL: DayState = { status: "loading", comments: [], total: 0, isOwner: false, maxLength: 500 };

export class CommentsError extends Error {
  constructor(
    public code: "rate_limited" | "too_long" | "offline" | "failed",
    public retryAfter?: number,
  ) {
    super(code);
  }
}

type Ctx = {
  stateFor: (daySlug: string) => DayState;
  /** Fetch a day's comments: the latest few, or all of them. */
  load: (daySlug: string, all?: boolean) => Promise<void>;
  post: (daySlug: string, body: string) => Promise<void>;
  edit: (daySlug: string, id: string, body: string) => Promise<void>;
  remove: (daySlug: string, id: string) => Promise<void>;
};

const CommentsContext = createContext<Ctx | null>(null);

/**
 * Comments under each day, fetched per day on demand — unlike reactions there
 * is text to hold, so only the day in view is loaded. The server decides who
 * may see anything; a `400`/`404` simply leaves the day `hidden`.
 */
export default function CommentsProvider({ tripId, children }: { tripId: string; children: React.ReactNode }) {
  const [days, setDays] = useState<Record<string, DayState>>({});
  // Whether a day was last loaded in full, so a refresh after a post keeps the list the reader sees.
  const full = useRef(new Set<string>());

  const load = useCallback(
    async (daySlug: string, all = false) => {
      if (all) full.current.add(daySlug);
      const query = `trip=${encodeURIComponent(tripId)}&day=${encodeURIComponent(daySlug)}${full.current.has(daySlug) ? "&all=1" : ""}`;
      try {
        const response = await fetch(`/api/comments?${query}`);
        if (!response.ok) {
          setDays((d) => ({ ...d, [daySlug]: { ...INITIAL, status: "hidden" } }));
          return;
        }
        const data = (await response.json()) as {
          comments: DayComment[];
          total: number;
          isOwner: boolean;
          limits: { maxLength: number };
        };
        setDays((d) => ({
          ...d,
          [daySlug]: {
            status: "ready",
            comments: data.comments,
            total: data.total,
            isOwner: data.isOwner,
            maxLength: data.limits.maxLength,
          },
        }));
      } catch {
        setDays((d) => ({ ...d, [daySlug]: { ...(d[daySlug] ?? INITIAL), status: "offline" } }));
      }
    },
    [tripId],
  );

  const send = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", daySlug: string, extra: Record<string, string>) => {
      let response: Response;
      try {
        response = await fetch("/api/comments", {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ trip: tripId, day: daySlug, ...extra }),
        });
      } catch {
        throw new CommentsError("offline");
      }
      if (response.ok) {
        await load(daySlug);
        return;
      }
      const data = (await response.json().catch(() => ({}))) as { error?: string; retryAfter?: number };
      if (response.status === 429) throw new CommentsError("rate_limited", data.retryAfter);
      if (data.error === "bad_body") throw new CommentsError("too_long");
      throw new CommentsError("failed");
    },
    [tripId, load],
  );

  const value = useMemo<Ctx>(
    () => ({
      stateFor: (day) => days[day] ?? INITIAL,
      load,
      post: (day, body) => send("POST", day, { body }),
      edit: (day, id, body) => send("PATCH", day, { id, body }),
      remove: (day, id) => send("DELETE", day, { id }),
    }),
    [days, load, send],
  );

  return <CommentsContext.Provider value={value}>{children}</CommentsContext.Provider>;
}

export function useComments() {
  return useContext(CommentsContext);
}
