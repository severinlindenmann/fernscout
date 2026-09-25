/**
 * Google's "G", for the one link on this site that opens Google Maps.
 *
 * Why a mark at all: on a phone the outbound button is the width of two words,
 * and "Maps ↗" alone does not say whose map. The logo is what carries that
 * once the sentence is gone (B1944) — the link's accessible name still reads
 * "Open in Google Maps: <place>", so nothing is lost to a screen reader.
 *
 * **This is Google's trademark, not ours, and it is used under their brand
 * permissions.** Four rules come with it and none of them are ours to relax:
 * the geometry and the four colours are fixed — never recoloured, rotated,
 * outlined, or put inside another shape; it is not used as an icon for
 * anything but this link; it never implies Google endorses this site; and the
 * link it sits on goes to Google Maps and nowhere else.
 *
 *   https://about.google/brand-resource-center/
 *
 * `aria-hidden` because the anchor already names itself. Sized in `em` so it
 * rides the button's text rather than needing its own breakpoint.
 */
export default function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.5 5.5 0 0 1-2.4 3.58v3h3.87c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3a7.2 7.2 0 0 1-10.7-3.77H1.36v3.09A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.36 14.32a7.2 7.2 0 0 1 0-4.61V6.62H1.36a12 12 0 0 0 0 10.79l4-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.36 6.62l4 3.09A7.15 7.15 0 0 1 12 4.75z"
      />
    </svg>
  );
}
