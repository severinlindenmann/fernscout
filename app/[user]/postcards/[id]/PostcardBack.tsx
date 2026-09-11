"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";

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
    /** The card width, in CSS px, above which the message is genuinely at
     * print size rather than held up by the floor — B1286. */
    messageTrueAbovePx: number;
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
  /** Shown once the card is measured wide enough that the message really is
   * at print size — B1286. */
  caption: string;
  /** Shown everywhere narrower, where a floor is holding the message legible
   * instead of true to scale. */
  captionNotToScale: string;
  /** Who prints the address and the postage mark — B982. */
  printerAdds: string;
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
  /** The first recipient's address, as the *printer* will set it — B982.
   *
   * Lines rather than fields, and composed by `printerAddressLines`: this
   * block is no longer something this product draws on the card. Stannp is
   * handed the recipient as data and prints the address and the postage mark
   * itself, so what belongs on screen is what it will print, marked as not
   * ours. */
  address: string[] | null;
  /** False once the order has left `draft`, or once it has expired: the card
   * is then a record of what was sent rather than something to change. */
  editable: boolean;
  strings: BackStrings;
}) {
  const [message, setMessage] = useState(initial.message);
  const [from, setFrom] = useState(initial.from);
  const [locale, setLocale] = useState(initial.locale);
  const [figures, setFigures] = useState(initial.figures);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  /**
   * Whether a request is actually in the air — B892, and not the same question
   * as `state === "saving"`.
   *
   * `state` goes to `"saving"` on every keystroke, 700ms before anything is
   * sent, because the status line's promise is that it never saves silently
   * and a pending save counts. Driving the *button* from that would disable it
   * and flip its label to "Saving…" on every letter typed — a control
   * flickering under the reader's own hands, which is the jumpiness this
   * ticket is about rather than a cure for it.
   */
  const [inFlight, setInFlight] = useState(false);

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

  /**
   * Whether the card is currently rendering at its real print scale — B1286.
   *
   * Starts `false`: the server cannot know the reader's width, and a phone is
   * the common case, so the first paint (server and client alike, avoiding a
   * hydration mismatch) claims the more modest thing. A `ResizeObserver`
   * corrects it once the card's actual width is known, and again on every
   * resize — the same card can cross the threshold when a phone rotates or a
   * window is dragged wider.
   */
  const [trueScale, setTrueScale] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const check = (width: number) =>
      setTrueScale(width >= layout.font.messageTrueAbovePx);
    check(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) check(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout.font.messageTrueAbovePx]);

  /**
   * One save, used by the debounce below and by the button — B892.
   *
   * The button used to be a plain submit inside the `<form method="post">`,
   * which meant that pressing it with JavaScript *on* did a full document
   * post: a redirect, a page load, a flash, and the reader back at the top —
   * to save words the debounce had already saved a moment earlier. It was the
   * jumpiest thing on the page and it bought nothing.
   *
   * A `useCallback` rather than a ref written during render: the effect below
   * already re-arms on every keystroke, since `message` is one of its
   * dependencies, so listing this costs nothing.
   */
  const save = useCallback(() => {
    const mine = ++request.current;
    setState("saving");
    setInFlight(true);
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
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then((data: { result?: string }) => {
        if (mine !== request.current) return;
        setState(data.result === "saved" ? "saved" : "failed");
      })
      .catch(() => {
        if (mine === request.current) setState("failed");
      })
      .finally(() => {
        if (mine === request.current) setInFlight(false);
      });
  }, [username, id, message, from, locale, figures, figuresSvg]);

  useEffect(() => {
    if (!editable) return;
    // Nothing to save on the first render: this is what the server already has.
    if (first.current) {
      first.current = false;
      return;
    }
    setState("saving");
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  }, [save, editable]);

  return (
    /**
     * Card left, form right, from `lg` — B1005.
     *
     * The page used to be one column at every width, so a desktop reader got a
     * phone layout with 900px of cream either side of it and had to scroll
     * between the words and the card those words were going on. The two belong
     * beside each other: this whole component exists so that typing changes
     * the drawing, and that is worth nothing if the drawing is off screen
     * while you type.
     *
     * The card comes first in the source, so on a phone — where this collapses
     * to one column — it is above the box, which is the order it has always
     * been in.
     */
    <div className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,8fr)] lg:items-start">
      <figure className="lg:sticky lg:top-4">
        {/* The container query container is *this* element — the card — and
            not the paragraph inside it. B451: `containerType` was on the `<p>`,
            so every `cqw` resolved against the message column's own width and
            the type came out at roughly twice its real size. */}
        <div
          ref={cardRef}
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
              // B849. The overrides are load bearing, and `!` is what makes
              // them win: `travellersSvg` sizes itself `height:<n>cqh`, and
              // `cqh` is a *height* query unit that an `inline-size` container
              // — which is what this card is, two elements up — cannot answer.
              // It resolved past the card to the viewport, so the figures came
              // out about a window tall inside a box 22 × 14 mm on a 148 × 105
              // card: drawn every time, and never once visible. B740 is the
              // same unit going wrong in the photobook, where the fix was to
              // make the sheet a size container; here the box already carries
              // an explicit width and height from `backLayout`, so the honest
              // answer is to let the box do the sizing and let the viewBox
              // letterbox inside it — which is precisely what `drawTravellers`
              // does on the paper.
              className="absolute [&>svg]:h-full! [&>svg]:w-full!"
              style={layout.figures}
              // The same SVG the photobook and the travellers bench draw.
              dangerouslySetInnerHTML={{ __html: figuresSvg }}
            />
          ) : null}
          <span
            className="absolute w-px bg-black/20"
            style={{ left: layout.dividerLeft, top: "8%", height: "84%" }}
          />
          {/* The postage mark and the address are the printer's — B982, and
              the reason the card sent to Stannp now carries neither. Their
              press lays its own indicia in this corner and its own address
              block below it; ours used to be printed underneath both, one
              name across the other. They are still drawn here, because what
              somebody is checking on this page is who the card is going to —
              but drawn as what they are, in a dashed outline rather than as
              part of the card. */}
          <span
            className="absolute rounded-sm border border-dashed border-black/25"
            style={layout.stamp}
          />
          <div
            className="absolute whitespace-nowrap text-black/70"
            style={{
              ...layout.address,
              fontSize: layout.font.address,
              lineHeight: layout.font.addressLeading,
            }}
          >
            {address?.map((line, i) => (
              <span key={i} className={i === 0 ? "font-semibold" : undefined}>
                {line}
                <br />
              </span>
            ))}
          </div>
        </div>
        <figcaption className="mt-1 text-xs text-navy-600">
          {trueScale ? strings.caption : strings.captionNotToScale}
        </figcaption>
        {/* Its own paragraph rather than a second sentence in the caption: the
            caption names the drawing ("the back, at print size") and this is
            about two things on it that are not ours to draw. Run together they
            read as one run-on line — B982. */}
        {address ? (
          <p className="mt-1 text-xs text-navy-500">{strings.printerAdds}</p>
        ) : null}
      </figure>

      {editable ? (
        <form
          method="post"
          action={`/${username}/postcards/${id}/message`}
          // With JavaScript off this handler does not exist and the form posts
          // and redirects exactly as it always did — which is the whole point
          // of it still being a real `<form method="post" action=…>`. With
          // JavaScript on, saving is the same `fetch` the debounce uses, so
          // the press costs no page load. B892.
          onSubmit={
            editable
              ? (e) => {
                  e.preventDefault();
                  save();
                }
              : undefined
          }
          className="rounded-lg border border-navy-200 bg-white px-3 py-3"
        >
          <label className="block text-sm font-semibold text-navy-800">
            {strings.messageLabel}
            {/* Eight rows, not four — B1005. A card takes 600 characters and
                the box showed about a fifth of them, so the thing a person
                came here to write was the smallest control on the screen and
                scrolled inside itself while they wrote. `field-sizing` grows
                it further where the browser has it, and the `min-h` is what
                holds the floor everywhere else. */}
            <textarea
              name="message"
              rows={8}
              maxLength={600}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 min-h-44 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-normal text-navy-900 [field-sizing:content]"
            />
          </label>
          {/* Two columns from `sm`, stacked below it — B1018.
              This was `flex flex-wrap gap-3` with no basis on either label, so
              each field was sized by its own content while the control inside
              it asked for `w-full` of that: the box changed width when the
              value changed, and the select's native arrow went wherever that
              left it — onto a line of its own, under the word, once the labels
              were German. A grid gives both fields a width that does not
              depend on what is in them. */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-semibold text-navy-800">
              {strings.signed}
              <input
                name="from"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm font-normal text-navy-900"
              />
            </label>
            {locales.length > 1 ? (
              <label className="min-w-0 text-sm font-semibold text-navy-800">
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
            {/* `busy` is given now that the press is a `fetch` and there is a
                state to report — B892. It used to self-watch, which was right
                while the press was a document post and useless in practice:
                the navigation threw the page away before a spinner could
                turn. */}
            <BusyButton
              type="submit"
              busy={inFlight}
              busyLabel={strings.saving}
              className="min-h-11 w-full rounded-full border-2 border-navy-900 px-5 text-sm font-semibold text-navy-900 transition-colors hover:bg-navy-900 hover:text-white disabled:opacity-70 sm:w-auto"
            >
              {strings.save}
            </BusyButton>
            {/* Never silent, and never claiming more than it knows. */}
            <span
              role="status"
              className={`text-xs ${state === "failed" ? "font-semibold text-coral-600" : "text-navy-600"}`}
            >
              {/* Not while the button is already saying it — B892. The two
                  sat one above the other reading "Saving…" twice. `saved` and
                  `failed` stay here, because the button never says those. */}
              {state === "saving" && !inFlight
                ? strings.saving
                : state === "saved"
                  ? strings.saved
                  : state === "failed"
                    ? strings.failed
                    : ""}
            </span>
          </div>
          <p className="mt-2 text-xs text-navy-600">{strings.sameCard}</p>
        </form>
      ) : null}
    </div>
  );
}
