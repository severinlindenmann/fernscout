import { ImageResponse } from "next/og";
import { serverSite } from "@/lib/site";

// The card shown when the site is shared on social / chat apps.
// Satori (the renderer behind ImageResponse) requires an explicit `display`
// on every element that has more than one child, so each div sets one.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = serverSite().name;

export default function OpengraphImage() {

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
          <div
            style={{
              display: "flex",
              marginLeft: 26,
              fontSize: 76,
              fontWeight: 700,
              color: "#1e293b",
            }}
          >
            {serverSite().name}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 36,
            lineHeight: 1.35,
            color: "#3a4a63",
            maxWidth: 900,
          }}
        >
          A travel journal your agent writes for you.
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
    size,
  );
}

