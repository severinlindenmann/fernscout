"use client";

import { useCallback, useState, type ReactNode } from "react";

/**
 * A photograph that fades in once it has arrived, over a frame that shimmers
 * while it is on the way — the `.fs-photo` rule in `app/globals.css`.
 *
 * Spread `frame` on the element that holds the picture (it must carry the
 * `fs-photo` class) and `img` on the picture itself.
 *
 * **Hidden only when it is known to be missing.** The server renders every
 * picture visible, and the frame only takes `data-loading` when the `<img>`
 * is found incomplete as React attaches to it. A picture that had already
 * loaded by then — from the cache, or simply fast — fires no `load` React
 * can hear, and would otherwise stay hidden for good; with JavaScript off
 * nothing ever attaches, so nothing is ever hidden. An error reveals as well:
 * a broken picture is still an answer, and the shimmer should stop.
 */
export function usePhotoReveal() {
  const [loading, setLoading] = useState(false);

  const ref = useCallback((node: HTMLImageElement | null) => {
    if (node && !node.complete) setLoading(true);
  }, []);
  const done = useCallback(() => setLoading(false), []);

  return {
    frame: { "data-loading": loading || undefined },
    img: { ref, onLoad: done, onError: done },
  };
}

/**
 * The frame half of `usePhotoReveal`, for a list that cannot call a hook per
 * item — a gallery's tiles. `className` is the frame's own layout; the
 * picture comes from `children`, handed the props to spread on its `<img>`.
 */
export function PhotoFrame({
  className,
  children,
}: {
  className: string;
  children: (img: ReturnType<typeof usePhotoReveal>["img"]) => ReactNode;
}) {
  const { frame, img } = usePhotoReveal();
  return (
    <span className={`fs-photo ${className}`} {...frame}>
      {children(img)}
    </span>
  );
}
