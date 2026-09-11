"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";

/**
 * Who the cards are going to, and changing it — B1005.
 *
 * This was a read-only `<ul>` with the addresses behind a `<details>`, under a
 * line saying the people were fixed and that changing them meant composing
 * another order. It said so beneath the writing, which is the work that would
 * be thrown away. Nothing in the send path required it (see the route), so
 * these are checkboxes now.
 *
 * **The addresses stay behind the disclosure**, and for the reason the page has
 * always given: the owner is entitled to them — they are posting to them — but
 * this page is opened on a phone, at a table, with other people at the table,
 * and "are these the right four people" does not need four home addresses on
 * screen to answer.
 *
 * **A change costs money, so it is saved on a press rather than as you tick.**
 * The rest of this page autosaves; this does not, because the number under the
 * button is a price and a list that changed under a debounce would move it
 * while somebody was reading it. `router.refresh()` after the save is what
 * brings that price — computed on the server from the list — back in step,
 * without a page load.
 *
 * With JavaScript off it is the same `<form method="post">` to the same route,
 * which redirects back exactly as the other two forms on this page do.
 */
export default function PostcardPeople({
  username,
  id,
  candidates,
  chosen,
  editable,
  strings,
}: {
  username: string;
  id: string;
  /** Everyone who has asked this journal for a postcard, with a town and never
   * a street until the disclosure is opened. */
  candidates: {
    contactId: string;
    name: string;
    city: string;
    country: string | null;
    /** "usually reads German", already in the reader's own language, or null
     * when this person reads what the card is written in. A finished sentence
     * rather than a locale and a formatter: everything that crosses into a
     * client component has to be serialisable, and a function is the one thing
     * that is not — passing `t` through here is a 500 on the page, which is
     * how this was found. */
    readsNote: string | null;
    address: { line1: string; line2: string; postcode: string; city: string } | null;
  }[];
  chosen: string[];
  /** False once the order has left `draft` or expired — then this is a record
   * of who it went to. */
  editable: boolean;
  strings: {
    heading: string;
    save: string;
    saving: string;
    saved: string;
    failed: string;
    lost: string | null;
    none: string;
  };
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(chosen);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");

  const dirty =
    picked.length !== chosen.length || picked.some((id) => !chosen.includes(id));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setState("idle");
    const body = new FormData();
    for (const contactId of picked) body.append("recipient", contactId);
    const response = await fetch(`/${username}/postcards/${id}/recipients`, {
      method: "POST",
      headers: { accept: "application/json" },
      body,
    }).catch(() => null);
    const answer = (await response?.json().catch(() => null)) as {
      result?: string;
    } | null;
    setBusy(false);
    if (answer?.result === "saved") {
      setState("saved");
      // The price, the "going to N people" count and the send button's own
      // label are all server-rendered from this list. This is what puts them
      // right without throwing the page away.
      router.refresh();
    } else {
      setState("failed");
    }
  }

  return (
    <section className="rounded-xl border border-navy-200 bg-white p-4">
      <h3 className="font-display text-base font-semibold text-navy-900">
        {strings.heading}
      </h3>
      {strings.lost ? (
        <p className="mt-1 text-sm text-navy-600">{strings.lost}</p>
      ) : null}

      {candidates.length === 0 ? (
        <p className="mt-2 text-sm text-navy-600">{strings.none}</p>
      ) : (
        <form
          method="post"
          action={`/${username}/postcards/${id}/recipients`}
          onSubmit={editable ? save : undefined}
          className="mt-3"
        >
          <ul className="space-y-1 text-sm">
            {candidates.map((candidate) => {
              const on = picked.includes(candidate.contactId);
              // Somebody who withdrew their address is not offered, so an id
              // on the order that is no longer a candidate simply is not here
              // — `lost` above is what says so in words.
              return (
                <li key={candidate.contactId}>
                  <div className="flex min-h-11 items-center gap-3">
                    {/* Initials, as the drawing has them — B1489. A list of
                        four names with a checkbox each reads as a form; the
                        same four with a face-sized circle in front read as
                        people, which is what a person is checking here. */}
                    <span
                      aria-hidden
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-100 text-[0.6rem] font-bold text-navy-700"
                    >
                      {candidate.name
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase() ?? "")
                        .join("")}
                    </span>
                    <input
                      type="checkbox"
                      id={`to-${candidate.contactId}`}
                      name="recipient"
                      value={candidate.contactId}
                      checked={on}
                      disabled={!editable}
                      onChange={(e) =>
                        setPicked((was) =>
                          e.target.checked
                            ? [...was, candidate.contactId]
                            : was.filter((id) => id !== candidate.contactId),
                        )
                      }
                      className="h-4 w-4 shrink-0"
                    />
                    <label
                      htmlFor={`to-${candidate.contactId}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="block text-sm font-semibold text-navy-900">
                        {candidate.name}
                      </span>
                      <span className="block text-xs text-navy-600">
                        {candidate.city}
                        {candidate.country ? `, ${candidate.country}` : ""}
                      </span>
                      {candidate.readsNote ? (
                        <span className="opacity-60">
                          {" · "}
                          {candidate.readsNote}
                        </span>
                      ) : null}
                    </label>
                  </div>
                  {candidate.address && on ? (
                    <details className="pl-[4.25rem]">
                      <summary className="cursor-pointer text-xs text-navy-600">
                        {candidate.address.postcode} {candidate.address.city}
                      </summary>
                      <address className="mt-1 text-xs not-italic opacity-80">
                        {candidate.address.line1}
                        {candidate.address.line2 ? (
                          <>
                            <br />
                            {candidate.address.line2}
                          </>
                        ) : null}
                        <br />
                        {candidate.address.postcode} {candidate.address.city}
                      </address>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {editable ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <BusyButton
                type="submit"
                busy={busy}
                busyLabel={strings.saving}
                disabled={!dirty || picked.length === 0}
                className="min-h-11 rounded-full border-2 border-navy-900 px-5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900 hover:text-white disabled:opacity-40"
              >
                {strings.save}
              </BusyButton>
              <span
                role="status"
                className={`text-xs ${state === "failed" ? "font-semibold text-coral-600" : "text-navy-600"}`}
              >
                {state === "saved" && !dirty
                  ? strings.saved
                  : state === "failed"
                    ? strings.failed
                    : ""}
              </span>
            </div>
          ) : null}
        </form>
      )}
    </section>
  );
}
