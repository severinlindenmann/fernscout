"use client";

import { useMemo, useState } from "react";
import SmsSend from "./SmsSend";

/**
 * The instance's SMS number as conversations — one per other number, newest
 * conversation first, each read top to bottom like a phone does.
 *
 * Grouping is by the number at the other end: an inbound message's sender,
 * an outbound one's recipient. That is arithmetic on the two columns
 * `sms_messages` already has; nothing here marks anything read or decides
 * what a message means (`lib/sms/store.ts` keeps it that way on purpose).
 *
 * The reply form is `SmsSend`, pre-filled with the thread's number and still
 * editable. A sent message appears on the next load, because the list is the
 * server's, not a copy this component patches.
 */

export type SmsRow = {
  id: string;
  direction: "in" | "out";
  from: string;
  to: string;
  body: string;
  dryRun: boolean;
  createdAt: string;
};

export type Thread = { number: string; messages: SmsRow[]; last: string };

/** Exported for the tests. Messages oldest first within a thread; threads by
 *  their newest message, newest first. */
export function threadsOf(rows: SmsRow[]): Thread[] {
  const by = new Map<string, SmsRow[]>();
  for (const row of rows) {
    const other = row.direction === "in" ? row.from : row.to;
    by.set(other, [...(by.get(other) ?? []), row]);
  }
  return [...by]
    .map(([number, messages]) => {
      const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { number, messages: sorted, last: sorted[sorted.length - 1].createdAt };
    })
    .sort((a, b) => b.last.localeCompare(a.last));
}

function stamp(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

export default function SmsThreads({
  rows,
  canSend,
  sendNote,
}: {
  rows: SmsRow[];
  canSend: boolean;
  /** Why sending is off, when it is. */
  sendNote: string;
}) {
  const threads = useMemo(() => threadsOf(rows), [rows]);
  // `null` is a new message to a number not in the list.
  const [picked, setPicked] = useState<string | null>(threads[0]?.number ?? null);
  const thread = threads.find((one) => one.number === picked) ?? null;

  return (
    <div className="overflow-hidden rounded-3xl border border-line-quiet bg-surface-raised lg:flex lg:min-h-[28rem]">
      <div className="border-b border-line-faint lg:w-64 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-3">
          <span className="text-sm font-semibold text-ink-secondary">
            {threads.length} {threads.length === 1 ? "conversation" : "conversations"}
          </span>
          {canSend ? (
            <button
              type="button"
              onClick={() => setPicked(null)}
              className="ml-auto min-h-9 rounded-lg border border-line-quiet px-3 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
            >
              New
            </button>
          ) : null}
        </div>
        <ul className="max-h-64 overflow-y-auto lg:max-h-none">
          {threads.map((one) => {
            const last = one.messages[one.messages.length - 1];
            return (
              <li key={one.number}>
                <button
                  type="button"
                  aria-pressed={one.number === picked}
                  onClick={() => setPicked(one.number)}
                  className={`block w-full border-t border-line-faint px-4 py-3 text-left ${
                    one.number === picked ? "bg-surface-subtle" : "hover:bg-surface-neutral"
                  }`}
                >
                  <span className="flex items-baseline gap-2">
                    <span className="font-mono text-sm font-semibold text-ink-strong">+{one.number}</span>
                    <span className="ml-auto font-mono text-xs text-ink-secondary">{one.last.slice(5, 10)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-ink-body">
                    {last.direction === "out" ? "You: " : ""}
                    {last.body}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-1 flex-col bg-surface-neutral">
        {thread ? (
          <ol className="flex flex-1 flex-col gap-2.5 p-4">
            {thread.messages.map((sms) => (
              <li
                key={sms.id}
                className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                  sms.direction === "in"
                    ? "self-start rounded-bl-md border border-line-faint bg-surface-raised text-ink-strong"
                    : "self-end rounded-br-md bg-action-strong text-on-action"
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-base leading-7">{sms.body}</p>
                <p className="mt-1 font-mono text-[11px] opacity-80">
                  {stamp(sms.createdAt)}
                  {sms.direction === "out" ? ` · from +${sms.from}` : ""}
                  {sms.dryRun ? " · dry-run, not sent" : ""}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="flex-1 p-4 text-sm text-ink-body">
            {threads.length === 0 && !canSend ? "No messages yet." : "A new message, to any number."}
          </p>
        )}
        <div className="border-t border-line-faint bg-surface-raised p-4">
          {canSend ? (
            <SmsSend key={picked ?? "new"} initialTo={picked ? `+${picked}` : ""} />
          ) : (
            <p className="text-sm text-ink-body">{sendNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}
