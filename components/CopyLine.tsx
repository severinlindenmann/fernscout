"use client";

import { useEffect, useState } from "react";

/**
 * The one interactive element on the landing page.
 *
 * The page's whole purpose is to hand somebody a string they will paste into
 * an agent, so copying it is the primary action rather than a convenience. The
 * button states its outcome and keeps the same word after it happens, so the
 * label is never a promise the interface then contradicts.
 */
export default function CopyLine({
  value,
  label,
  copiedLabel,
  name,
}: {
  value: string;
  label: string;
  /** What the button reads after a successful copy. */
  copiedLabel: string;
  /**
   * The accessible name, when reciting the value would not make one.
   *
   * By default the name is "<label>: <value>", which is right for the single
   * address every caller but one hands over. The agent-handover block copies
   * *two* values joined by a newline, and a newline inside an accessible name
   * is not reliably announced as a break — so a screen reader ran a URL and an
   * email address together into one string with no boundary, under a name that
   * said "Copy link". B199. A caller with more than one value to copy passes a
   * name that says what it copies instead; the values themselves are on the
   * page as text, which is where they are readable one at a time.
   */
  name?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        } catch {
          // Clipboard access can be refused. The address is on screen and
          // selectable, so saying nothing is better than an apology.
          setCopied(false);
        }
      }}
      aria-label={name ?? `${label}: ${value}`}
      // The focus ring is the global blue-500 one from globals.css: sky-500
      // is 2.73:1 on white and 2.63:1 on cream, so as a ring it failed the 3:1
      // that a focus indicator needs on every surface it is drawn against.
      className="group inline-flex min-h-11 items-center gap-2 rounded-lg border border-navy-200
                 bg-cream-50 px-4 font-mono text-base text-navy-700 transition-colors
                 hover:border-navy-700 hover:text-navy-900"
    >
      <span aria-hidden="true">{copied ? copiedLabel : label}</span>
      <span className="sr-only" role="status">
        {copied ? copiedLabel : ""}
      </span>
    </button>
  );
}
