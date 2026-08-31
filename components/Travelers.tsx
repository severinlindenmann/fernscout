"use client";

import { motion } from "motion/react";

// Us: two white European travellers — him with short brown-blond hair, her
// with long brown hair. Tweak these if you want to fine-tune the likeness.
const HIM = {
  skin: "#f7d7bb",
  hair: "#a67c42", // short, brown-blond
  shirt: "#3b82f6",
  shirtDark: "#2563eb",
  pants: "#37475f",
  pack: "#f0c05a",
};

const HER = {
  skin: "#f9dcc4",
  hair: "#6b4423", // long, brown
  shirt: "#f472b6",
  shirtDark: "#ec4899",
  pants: "#3f4a5f",
  pack: "#5fb08a",
};

export default function Travelers({ size = 76 }: { size?: number }) {
  return (
    <div className="flex items-end" style={{ gap: size * 0.02 }}>
      <Person size={size} {...HIM} delay={0} />
      <Person size={size * 0.95} {...HER} delay={0.28} longHair />
    </div>
  );
}

function Person({
  size,
  skin,
  hair,
  shirt,
  shirtDark,
  pants,
  pack,
  delay,
  longHair = false,
}: {
  size: number;
  skin: string;
  hair: string;
  shirt: string;
  shirtDark: string;
  pants: string;
  pack: string;
  delay: number;
  longHair?: boolean;
}) {
  return (
    <motion.svg
      width={size}
      height={size * 1.5}
      viewBox="0 0 64 96"
      animate={{ y: [0, -2.5, 0] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", delay }}
      style={{ overflow: "visible" }}
    >
      <ellipse cx="32" cy="92" rx="17" ry="3.5" fill="rgba(30,41,59,0.14)" />

      {/* long hair falls behind the body */}
      {longHair && <path d="M14 26 q-3 26 2 38 q16 5 32 0 q5-12 2-38 z" fill={hair} />}

      {/* backpack peeking behind the shoulder */}
      <rect x="6" y="40" width="15" height="21" rx="6" fill={pack} />
      <rect x="9" y="46" width="9" height="3" rx="1.5" fill="rgba(0,0,0,0.12)" />

      {/* legs */}
      <rect x="21" y="64" width="9.5" height="24" rx="4.75" fill={pants} />
      <rect x="33.5" y="64" width="9.5" height="24" rx="4.75" fill={pants} />
      <ellipse cx="25.5" cy="89" rx="6.5" ry="3.2" fill="#2b3648" />
      <ellipse cx="38.5" cy="89" rx="6.5" ry="3.2" fill="#2b3648" />

      {/* torso */}
      <path d="M17 42 q15 -6 30 0 l2 24 q-17 6 -34 0 z" fill={shirt} />
      <path d="M17 42 q15 -6 30 0 l0.6 7 q-15 -5 -31 0 z" fill={shirtDark} opacity="0.5" />

      {/* arms */}
      <rect x="11.5" y="44" width="8" height="22" rx="4" fill={shirt} />
      <rect x="44.5" y="44" width="8" height="22" rx="4" fill={shirt} />
      <circle cx="15.5" cy="67" r="4.6" fill={skin} />
      <circle cx="48.5" cy="67" r="4.6" fill={skin} />

      {/* head */}
      <circle cx="32" cy="24" r="16" fill={skin} />
      {longHair ? (
        // side-parted long hair framing the face
        <path d="M16 23 a16 16 0 0132 0 q-4 -9 -16 -9 q-12 0 -16 9z" fill={hair} />
      ) : (
        // short, slightly tousled crop
        <path d="M16.5 22 a15.5 15.5 0 0131 0 q-4 -6 -9 -4 q-6 -4 -13 0 q-6 -1 -9 4z" fill={hair} />
      )}
      <circle cx="25.5" cy="25" r="2" fill="#3b2b1d" />
      <circle cx="38.5" cy="25" r="2" fill="#3b2b1d" />
      <path
        d="M27.5 31.5 q4.5 4 9 0"
        stroke="#8a5a3a"
        strokeWidth="1.9"
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="21" cy="30" r="2.8" fill="#f6a6b6" opacity="0.45" />
      <circle cx="43" cy="30" r="2.8" fill="#f6a6b6" opacity="0.45" />
    </motion.svg>
  );
}
