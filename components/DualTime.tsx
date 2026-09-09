"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "./LocaleProvider";
import { formatTimeInZone } from "@/lib/timezone";

/** Nothing here ever changes, so a subscriber has nothing to do. */
const noop = () => () => {};
const readerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || null;
const noZoneOnTheServer = () => null;

/**
 * An entry's own clock, quietly paired with the reader's — B42.
 *
 * Renders bare `time` on the server and on the client's first paint, so there
 * is nothing here JavaScript-off cannot read and nothing a hydration diff
 * could catch. Only once hydrated does the browser answer for its own zone,
 * and only when that differs does the reader's own equivalent appear —
 * "09:15 local · 04:15 your time".
 *
 * `useSyncExternalStore` rather than an effect, and for the reason
 * `components/SearchBox.tsx` already gives for its own client-only read: the
 * server has no `Intl` answer to give, so it renders the third argument and
 * the browser decides for itself afterwards. An effect that called
 * `setState` would be the same picture arrived at through a cascading render.
 *
 * Without `timezone` there is no zone to compare against, so it never guesses
 * one and always renders the bare time, exactly as before this field existed.
 */
export default function DualTime({
  date,
  time,
  timezone,
}: {
  date: string;
  time: string;
  timezone?: string;
}) {
  const { t } = useI18n();
  const zone = useSyncExternalStore(noop, readerZone, noZoneOnTheServer);

  if (!timezone || !zone || zone === timezone) return <>{time}</>;
  return (
    <>
      {time} {t("time.local")} ·{" "}
      {t("time.yourTime", { time: formatTimeInZone(date, time, timezone, zone) })}
    </>
  );
}
