"use client";

import { useEffect, useState } from "react";

/**
 * The keyboard, while a photograph is open full-screen.
 *
 * Both photo viewers used to listen on `window`, and so does the story pager
 * underneath them. Two listeners on the same node cannot stop each other, so
 * one press of → advanced the picture *and* the day: the viewer closed with
 * the page it belonged to, and the reader lost their place. It looked like the
 * arrow keys were simply broken.
 *
 * A viewer is a modal. It owns the keyboard while it is open, which needs
 * three things and not only the third:
 *
 *   - focus moves into it, because a keystroke goes to whatever has focus, and
 *     after a click that is still the thumbnail out in the page;
 *   - the handler sits on the dialog's own element, so the event is stopped on
 *     the way up, before it reaches anything listening on `window`;
 *   - focus goes back to the thumbnail on close, so the reader is where they
 *     were rather than at the top of the document.
 *
 * Every key is swallowed, not only the ones used here: the page behind a modal
 * should not respond to the keyboard at all, and PageDown paged it too.
 *
 * Spread the returned props on the overlay element.
 */
export function useLightbox({
  open,
  onClose,
  onPrev,
  onNext,
}: {
  open: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  // The node as state rather than a ref: the effects below need to run once
  // it exists, and a ref does not tell them when that happened.
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  // Whatever had focus when it opened — the thumbnail, in practice.
  useEffect(() => {
    if (!open || !node) return;
    const opener = document.activeElement as HTMLElement | null;
    node.focus();
    return () => opener?.focus?.();
  }, [open, node]);

  useEffect(() => {
    if (!open || !node) return;

    const onKey = (e: KeyboardEvent) => {
      // Modifier combinations are the browser's, not ours: Cmd-W still closes
      // the tab and Cmd-R still reloads.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.stopPropagation();

      if (e.key === "Escape") return onClose();
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        return onPrev?.();
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        return onNext?.();
      }
      if (e.key !== "Tab") return;

      // Tab cycles inside the dialog rather than walking off into the page
      // behind it, which is still there and still focusable.
      const focusable = node.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input, select, textarea, video[controls], [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [open, node, onClose, onPrev, onNext]);

  return {
    ref: setNode,
    role: "dialog" as const,
    "aria-modal": true,
    // Focusable itself, so the keyboard has somewhere to land on open; the
    // caller sets `outline-none`, since a ring around the whole screen is not
    // a useful focus indicator.
    tabIndex: -1,
  };
}
