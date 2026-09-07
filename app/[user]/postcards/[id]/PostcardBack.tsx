"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The back of the card, and the form that writes it — B773.
 *
 * These were a server-rendered drawing and a plain `<form method=post>` sitting
 * under it, with nothing between them: typing changed nothing, and the card
 * only caught up after **Save the back**, a redirect and a page load. The one
 * thing this page exists for — seeing what will be printed — was behind a
 * button.
 *
 * So the words are state here, the drawing renders from that state, and the
 * saving is a debounced `fetch` to the route that already existed. The
 * photobook composer next door has worked this way since it was built; this is
 * the same product asking the same question.
 *
 * **The form still works with JavaScript off.** It is the same `<form
 * method="post" action=…>` with the same field names and the same submit
 * button, and the route still redirects for a real form post. Nothing here is
 * the only way to save; it is the fast way.
 *
 * **It never saves silently.** A draft that expires in a week and a person who
 * closes the tab is exactly the case where "we think it saved" is not good
 * enough, so the status line says saving, saved, or could not save, and the
 * button stays as the thing to press when it says the last one.
 */

/** The geometry `backLayout` computes, as far as this component needs it. */
type Layout = {
  aspect: string;
  message: React.CSSProperties;
  dividerLeft: string;
  stamp: React.CSSProperties;
  address: React.CSSProperties;
  figures: React.CSSProperties;
  font: {
    message: string;
    leading: number;
    signature: string;
    address: string;
    addressLeading: number;
  };
};

export type BackStrings = {
  messageLabel: string;
  signed: string;
  writtenIn: string;
  figuresLabel: string;
  save: string;
  saving: string;
  saved: string;
  failed: string;
  sameCard: string;
  fixed: string;
  caption: string;
};

export default function PostcardBack({
  username,
  id,
  layout,
  initial,
  locales,
  localeLabel,
  figuresSvg,
  address,
  editable,
  strings,
}: {
  username: string;
  id: string;
  layout: Layout;
  initial: { message: string; from: string; locale: string; figures: boolean };
  /** The languages this journal writes in. Absent when there is only one. */
  locales: string[];
  localeLabel: Record<string, string>;
  /** The party as SVG, or null when this trip describes nobody — in which case
   * there is no switch to show either. */
  figuresSvg: string | null;
  /** The first recipient's address, already resolved to lines. */
  address: { name: string; line1: string; postcode: string; city: string } | null;
  /** False once the order has left `draft`, or once it has expired: the card
   * is then a record of what was sent rather than something to change. */
  editable: boolean;
  strings: BackStrings;
}) {
  const [message, setMessage] = useState(initial.message);
  const [from, setFrom] = useState(initial.from);
  const [locale, setLocale] = useState(initial.locale);
  const [figures, setFigures] = useState(initial.figures);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");

  /**
   * The debounce, and the guard against an older save landing last.
   *
   * Same shape as the photobook preview's (`PhotobookPageContent`): a counter
   * bumped per request, and only the newest one is allowed to set the state.
   * Without it a slow first request can report "saved" after a later one has
   * already failed.
   */
  const request = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (!editable) return;
    // Nothing to save on the first render: this is what the server already has.
    if (first.current) {
      first.current = false;
      return;
    }
    const mine = ++request.current;
    setState("saving");
    const timer = setTimeout(() => {
      const body = new FormData();
      body.set("message", message);
      body.set("from", from);
      body.set("locale", locale);
      if (figuresSvg) {
        // The same pair of fields the form posts: "asked" is what tells an
        // unticked box from a form that never carried the question.
        body.set("figures_asked", "1");
        if (figures) body.set("figures", "on");
      }
      fetch(`/${username}/postcards/${id}/message`, {
        method: "POST",
        headers: { accept: "application/json" },
        body,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: { result?: string }) => {
          if (mine !== request.current) return;
          setState(data.result === "saved" ? "saved" : "failed");
        })
        .catch(() => {
          if (mine === request.current) setState("failed");
        });
    }, 700);
    return () => clearTimeout(timer);
  }, [username, id, message, from, locale, figures, figuresSvg, editable]);

  return (
    <>
      <figure>
        {/* The container query container is *this* element — the card — and
            not the paragraph inside it. B451: `containerType` was on the `<p>`,
            so every `cqw` resolved against the message column's own width and
            the type came out at roughly twice its real size. */}
        <div
          className="relative overflow-hidden rounded-lg border border-navy-200 bg-white text-black shadow-sm"
          style={{ aspectRatio: layout.aspect, containerType: "inline-size" }}
        >
          <p
            className="absolute overflow-hidden whitespace-pre-wrap"
            style={{
              ...layout.message,
              fontSize: layout.font.message,
              lineHeight: layout.font.leading,
            }}
          >
            {message}
          </p>
          <p
            className="absolute text-black/50"
            style={{
              left: layout.message.left,
              bottom: "6%",
              fontSize: layout.font.signature,
            }}
          >
            {from}
          </p>
          {figuresSvg && figures ? (
            <div
              className="absolute"
              style={layout.figures}
              // The same SVG the photobook and the travellers bench draw.
              dangerouslySetInnerHTML={{ __html: figuresSvg }}
            />
          ) : null}
          <span
            className="absolute w-px bg-black/20"
            style={{ left: layout.dividerLeft, top: "8%", height: "84%" }}
          />
          <span className="absolute rounded-sm border border-black/20" style={layout.stamp} />
          <div
            className="absolute"
            style={{
              ...layout.address,
              fontSize: layout.font.address,
              lineHeight: layout.font.addressLeading,
            }}
          >
            {address ? (
              <>
                <span className="font-semibold">{address.name}</span>
                <br />
                {address.line1}
                <br />
                {address.postcode} {address.city}
              </>
            ) : null}
          </div>
        </div>
        <figcaption className="mt-1 text-xs text-navy-600">{strings.caption}</figcaption>
      </figure>

      {editable ? (
        <form
          method="post"
          action={`/${username}/postcards/${id}/message`}
          className="mt-6 rounded-lg border border-navy-200 bg-white px-3 py-3 sm:col-span-2"
        >
          <label className="block text-sm font-semibold text-navy-800">
            {strings.messageLabel}
            <textarea
              name="message"
              rows={4}
              maxLength={600}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-normal text-navy-900"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <label className="text-sm font-semibold text-navy-800">
              {strings.signed}
              <input
                name="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-normal text-navy-900"
              />
            </label>
            {locales.length > 1 ? (
              <label className="text-sm font-semibold text-navy-800">
                {strings.writtenIn}
                <select
                  name="locale"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                  className="mt-1 block min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-normal text-navy-900"
                >
                  {locales.map((code) => (
                    <option key={code} value={code}>
                      {localeLabel[code] ?? code}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <input type="hidden" name="locale" value={locale} />
            )}
          </div>
          {figuresSvg ? (
            <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold text-navy-800">
              <input type="hidden" name="figures_asked" value="1" />
              <input
                type="checkbox"
                name="figures"
                checked={figures}
                onChange={(e) => setFigures(e.target.checked)}
                className="h-4 w-4"
              />
              {strings.figuresLabel}
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="min-h-11 w-full rounded-full border-2 border-navy-900 px-5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900 hover:text-white sm:w-auto"
            >
              {strings.save}
            </button>
            {/* Never silent, and never claiming more than it knows. */}
            <span
              role="status"
              className={`text-xs ${state === "failed" ? "font-semibold text-coral-600" : "text-navy-600"}`}
            >
              {state === "saving"
                ? strings.saving
                : state === "saved"
                  ? strings.saved
                  : state === "failed"
                    ? strings.failed
                    : ""}
            </span>
          </div>
          <p className="mt-2 text-xs text-navy-600">{strings.sameCard}</p>
          <p className="mt-1 text-xs text-navy-600">{strings.fixed}</p>
        </form>
      ) : null}
    </>
  );
}
