import type { Channel } from "@/lib/messages/registry";

/**
 * One glyph per channel, so a catalogue row, a flow node and a preview all
 * say "this is mail / SMS / WhatsApp / push / a share sheet" the same way —
 * the owner's own reading of the draft ("channel icons everywhere so it is
 * instantly clear what is mail/SMS/WhatsApp/push/share").
 *
 * Paths and per-channel colour are the ones the owner already approved in
 * the draft (`messages-draft.html`'s `IP`/`.ch-*`), redrawn as React rather
 * than copied wholesale — this codebase's Tailwind tokens carry the colour
 * instead of the draft's own CSS custom properties.
 */
export const CHANNEL_ICON_PATHS: Record<Channel, string> = {
  mail: 'M2 3.5h12a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H2A1.5 1.5 0 0 1 .5 14V5A1.5 1.5 0 0 1 2 3.5zM1 4.5 8 9l7-4.5',
  sms: "M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11H7l-3 2.5V11H3A1.5 1.5 0 0 1 1.5 9.5v-5A1.5 1.5 0 0 1 3 3z M5 7h.01 M8 7h.01 M11 7h.01",
  wa: "M8 1.8a6.2 6.2 0 0 0-5.4 9.3L1.8 14.2l3.2-.8A6.2 6.2 0 1 0 8 1.8z M5.8 5.2c.2-.3.6-.3.8 0l.6 1.2-.5.7c.4.8 1.1 1.5 1.9 1.9l.7-.5 1.2.6c.3.2.3.6 0 .8-.6.6-1.5.7-2.3.3A6 6 0 0 1 5.5 7.5c-.4-.8-.3-1.7.3-2.3z",
  push: "M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.3H2.8z M6.6 13.8a1.5 1.5 0 0 0 2.8 0",
  share: "M8 10V2M5.2 4.6 8 1.8l2.8 2.8 M5 7H3.5v7h9V7H11",
};

/** Tailwind background classes, one per channel — kept as a lookup so the
 * badge's colour is a single class name rather than an inline style. */
const BADGE: Record<Channel, string> = {
  mail: "bg-ink-strong",
  sms: "bg-sky-600",
  wa: "bg-green-600",
  push: "bg-yellow-600",
  share: "bg-coral-600",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  mail: "Email",
  sms: "SMS",
  wa: "WhatsApp",
  push: "App push",
  share: "Owner shares",
};

function ChannelBadge({ channel, size = "sm" }: { channel: Channel; size?: "sm" | "lg" }) {
  const box = size === "lg" ? "h-8 w-8 rounded-2xl" : "h-6 w-6 rounded-lg";
  const icon = size === "lg" ? 20 : 14;
  return (
    <span className={`inline-grid ${box} flex-none place-items-center text-on-action ${BADGE[channel]}`}>
      <svg width={icon} height={icon} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d={CHANNEL_ICON_PATHS[channel]} />
      </svg>
    </span>
  );
}

export default function ChannelChip({ channel, label = true }: { channel: Channel; label?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-ink-strong">
      <ChannelBadge channel={channel} />
      {label ? CHANNEL_LABEL[channel] : null}
    </span>
  );
}
