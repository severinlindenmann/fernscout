import { ImageResponse } from "next/og";

/** The sharing card's size — the one every messenger crops to. */
export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The sharing card: the mark, the instance's name, and one line — B2479
 * made it a function so the schools and tour-operator pages can have their
 * own card, in the reader's language, instead of the landing's English one.
 *
 * Satori (the renderer behind ImageResponse) requires an explicit `display`
 * on every element that has more than one child, so each div sets one.
 */
export function ogCard({ name, kicker, line }: { name: string; kicker?: string; line: string }): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "flex-start",
          background: "#fffaf0",
          padding: 96,
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <svg width="92" height="92" viewBox="0 0 32 32">
            <rect width="32" height="32" rx="7" fill="#1e293b" />
            {/* The waymark, copied verbatim from
                docs/branding/fernscout-mark.svg. ImageResponse cannot load a
                file, so this is one of the two sanctioned inline copies — see
                .claude/skills/apply-the-brand. If the mark changes, this changes
                with it.
        
                Copyright: see BRAND-LICENSE. Not licensed as the
                identity of another project. */}
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
          <div
            style={{
              display: "flex",
              marginLeft: 26,
              fontSize: 76,
              fontWeight: 700,
              color: "#1e293b",
            }}
          >
            {name}
          </div>
        </div>

        {kicker && (
          <div style={{ display: "flex", marginTop: 32, fontSize: 26, color: "#3a4a63", letterSpacing: 1 }}>
            {kicker}
          </div>
        )}

        <div
          style={{
            display: "flex",
            marginTop: kicker ? 14 : 28,
            fontSize: kicker ? 44 : 36,
            fontWeight: kicker ? 700 : 400,
            lineHeight: 1.3,
            color: kicker ? "#1e293b" : "#3a4a63",
            maxWidth: 1000,
          }}
        >
          {line}
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 40,
            height: 8,
            width: 168,
            background: "#ffd23f",
            borderRadius: 4,
          }}
        />
      </div>
    ),
    OG_SIZE,
  );
}
