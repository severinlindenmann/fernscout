"use client";

import { CircleCheck } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

export type DoneNext = { title: string; body?: string; href: string; label: string };

/**
 * The end of a studio write — B2064, rule 9: done is a screen, not a
 * navigation. A green band says what happened (`done`, one sentence in the
 * past or perfect: "Access is open to …"), then one to three "What next"
 * cards, each with one outlined link onward.
 *
 * **No back link of its own.** The studio bar (`StudioBar`, one per studio
 * page) already carries "← Studio"; a second "Back to the studio" in the body
 * is the duplicate this component exists to end. A caller that wants a way
 * home adds nothing: the bar is it.
 *
 * `next` is one to three cards or none, enforced by the type — a fourth is a
 * menu, not a next step.
 */
export default function DoneScreen({
  done,
  next,
}: {
  /** Kept in the props for the what-next hrefs a caller builds; unused here. */
  username: string;
  done: string;
  next?: [DoneNext] | [DoneNext, DoneNext] | [DoneNext, DoneNext, DoneNext];
}) {
  const { t } = useI18n();
  return (
    <div className="mt-4">
      <div
        role="status"
        className="studio-done-band flex items-start gap-2.5 rounded-2xl border border-green-500/40 bg-green-100 px-4 py-3 text-sm text-ink-strong"
      >
        <CircleCheck aria-hidden className="mt-px h-5 w-5 flex-none text-green-700" />
        <p>{done}</p>
      </div>
      {next && (
        <>
          <p className="mt-5 text-sm font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.done.whatNext")}</p>
          <ul className="mt-2 flex flex-col gap-3">
            {next.map((n, i) => (
              <li
                key={`${n.href} ${n.title}`}
                className="studio-done-card rounded-2xl border border-line-quiet bg-surface-raised p-4"
                style={{ "--i": i } as React.CSSProperties}
              >
                <p className="font-semibold text-ink-strong">{n.title}</p>
                {n.body && <p className="mt-1 text-sm text-ink-secondary">{n.body}</p>}
                <a
                  href={n.href}
                  className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line-strong px-4 font-semibold text-ink-strong hover:bg-surface-subtle"
                >
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
