/**
 * The waymark, copied verbatim from `docs/branding/fernscout-mark.svg` —
 * the same sanctioned inline copy `components/OgCard.tsx` already carries,
 * because `ImageResponse`/satori cannot load an external file. See
 * `.claude/skills/apply-the-brand`.
 *
 * Copyright: see BRAND-LICENSE. Not licensed as the identity of another
 * project.
 */
export function StoryMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#1e293b" />
      <path
        d="M6 25 L11.3 20.7 L15.7 19 L21 12.3 L26 8"
        fill="none"
        stroke="#fffaf0"
        strokeWidth="1.85"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 9 L23.7 16.7 L16 24.3 L8.3 16.7 Z"
        fill="#ffd23f"
        stroke="#1e293b"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="8" r="2.2" fill="#22c55e" stroke="#1e293b" strokeWidth="0.6" />
    </svg>
  );
}
