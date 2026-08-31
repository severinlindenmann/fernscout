import { ImageResponse } from "next/og";

// Apple devices ignore SVG favicons, so the touch icon is rendered to PNG at
// build time from the same waymark as app/icon.svg.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e293b",
        }}
      >
        <svg width="180" height="180" viewBox="0 0 32 32">
          {/* The waymark, copied verbatim from
              docs/branding/fernscout-mark.svg. ImageResponse cannot load a
              file, so this is one of the two sanctioned inline copies — see
              .claude/skills/apply-the-brand. If the mark changes, this changes
              with it. */}
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
      </div>
    ),
    size,
  );
}
