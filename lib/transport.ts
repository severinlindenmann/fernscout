import type { TransportMode } from "./types";

/** One colour per transport mode, used by the world-map route lines and their
 * legend so the two can never drift apart. */
export const TRANSPORT_STYLE: Record<
  TransportMode,
  { label: string; color: string; dash?: string }
> = {
  flight: { label: "Flight", color: "#3b82f6", dash: "10 7" },
  train: { label: "Train", color: "#8b5cf6" },
  bus: { label: "Bus", color: "#f59e0b" },
  motorbike: { label: "Motorbike", color: "#ef4444" },
  car: { label: "Car", color: "#14b8a6" },
  boat: { label: "Boat", color: "#06b6d4", dash: "6 5" },
  walk: { label: "Walk", color: "#22c55e", dash: "2 6" },
};
