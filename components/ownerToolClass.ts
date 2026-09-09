/**
 * The one look every owner control wears — B877.
 *
 * Its own module, and not a constant inside `OwnerTools.tsx`, because
 * `OwnerTools` imports the controls that need it and importing it back would
 * be a cycle. Three components render a tile: `DayNotify`, `InviteToRead` and
 * the correction link in `OwnerTools` itself.
 *
 * Why a shared string at all: the block this belongs to grew one control per
 * ticket across three sessions, each choosing its own button style, and ended
 * up as four controls in three weights with no hierarchy between them. They
 * are peers. Peers look the same.
 *
 * `w-full` and `grow` are for the grid it sits in — every tile fills its cell,
 * so a two-line label does not leave a short tile beside it.
 */
export const OWNER_TOOL =
  "flex min-h-11 w-full grow items-center rounded-lg border border-navy-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-5 text-navy-900 transition-colors hover:border-navy-500 disabled:opacity-60";

/** The wrapper a tile that can also show an error message needs. */
export const OWNER_TOOL_CELL = "flex flex-col gap-1";
