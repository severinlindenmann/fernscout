import {
  IMAGE_MAX_BYTES,
  IMAGE_MAX_EDGE,
  MAX_ITEMS_PER_DAY,
  VIDEO_MAX_BYTES,
  VIDEO_MAX_SECONDS,
} from "./validate/media";

/**
 * How much media a journal may hold, and how big each piece may be.
 *
 * The numbers in `lib/validate/media.ts` are the shipped defaults, chosen for
 * a personal journal on a small VPS. They are not right for everybody: a
 * photographer self-hosting on a NAS wants a far larger ceiling than somebody
 * running this on the smallest droplet their provider sells, and neither
 * should have to patch a source file to say so.
 *
 * Two levels, and they compose the way capabilities do (`lib/capabilities.ts`):
 * the server's numbers are a **ceiling**, and a user may only make their own
 * allowance *smaller*. On a shared instance the person paying for the disk
 * decides its size; on a single-user one they are the same person and it makes
 * no difference.
 *
 * `perUserBytes` is the only genuinely new limit. Everything else was already
 * enforced, just not adjustable.
 */
export type MediaLimits = {
  /** Bytes accepted for one image. */
  imageBytes: number;
  /** Longest edge, in pixels, for one image. */
  imageEdge: number;
  /** Bytes accepted for one video. */
  videoBytes: number;
  /** Seconds of video. */
  videoSeconds: number;
  /** Items on one day — one "post". */
  itemsPerDay: number;
  /**
   * Total bytes of media one journal may hold, originals included.
   *
   * `null` means no ceiling, which is the default: a limit nobody asked for
   * that stops somebody's holiday photographs uploading is worse than a disk
   * that fills up visibly. Set it on a shared instance.
   */
  perUserBytes: number | null;
};

export const DEFAULT_MEDIA_LIMITS: MediaLimits = {
  imageBytes: IMAGE_MAX_BYTES,
  imageEdge: IMAGE_MAX_EDGE,
  videoBytes: VIDEO_MAX_BYTES,
  videoSeconds: VIDEO_MAX_SECONDS,
  itemsPerDay: MAX_ITEMS_PER_DAY,
  perUserBytes: null,
};

/** A positive number, or the fallback. Zero and nonsense are not limits. */
function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Reads a `media:` block from either config file. Unknown keys are ignored. */
export function parseMediaLimits(raw: unknown, base = DEFAULT_MEDIA_LIMITS): MediaLimits {
  if (!raw || typeof raw !== "object") return base;
  const src = raw as Record<string, unknown>;
  return {
    imageBytes: positive(src.imageBytes, base.imageBytes),
    imageEdge: positive(src.imageEdge, base.imageEdge),
    videoBytes: positive(src.videoBytes, base.videoBytes),
    videoSeconds: positive(src.videoSeconds, base.videoSeconds),
    itemsPerDay: positive(src.itemsPerDay, base.itemsPerDay),
    perUserBytes:
      src.perUserBytes === null
        ? null
        : typeof src.perUserBytes === "number" && src.perUserBytes > 0
          ? src.perUserBytes
          : base.perUserBytes,
  };
}

/**
 * The server's ceiling and the user's own preference, combined.
 *
 * Always the smaller of the two, per field. A user config asking for more than
 * the server allows is not an error — it is somebody stating a preference that
 * the instance cannot honour, and the answer is the instance's number.
 */
export function narrowest(ceiling: MediaLimits, asked: MediaLimits): MediaLimits {
  const bothOrTighter = (a: number | null, b: number | null): number | null => {
    if (a === null) return b;
    if (b === null) return a;
    return Math.min(a, b);
  };
  return {
    imageBytes: Math.min(ceiling.imageBytes, asked.imageBytes),
    imageEdge: Math.min(ceiling.imageEdge, asked.imageEdge),
    videoBytes: Math.min(ceiling.videoBytes, asked.videoBytes),
    videoSeconds: Math.min(ceiling.videoSeconds, asked.videoSeconds),
    itemsPerDay: Math.min(ceiling.itemsPerDay, asked.itemsPerDay),
    perUserBytes: bothOrTighter(ceiling.perUserBytes, asked.perUserBytes),
  };
}
