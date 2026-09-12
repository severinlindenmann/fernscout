// The figure library — B1587, owner review round. /api/v2/{user}/figures.
//
// A figure is how somebody is drawn as a walking traveller. In v1 figures
// lived inline on each trip (the travellers: block); in v2 they are a
// journal-level library referenced by id, so one person is drawn the same
// on every trip and a trip only says WHICH figures walk, not how they look.
//
// Structured for the future "buddy" mode without shipping it: a figure may
// name the person it depicts (`person`, an email), which is what will let a
// trip one day say mode: "people" and have the server combine each
// traveller's own figure. No mode reads `person` yet.
import { z } from "zod";
import {
  ACCESSORIES,
  AGES,
  BUILDS,
  HAIR_STYLES,
  MAX_FIGURES,
  OUTFITS,
} from "../../../travellers/vocabulary";
import { ID_RE } from "../../../tripWrite";

/** A named token from the field's own table (see /travellers/presets for the
 * vocabulary), or a #hex colour. Which tokens each field accepts is the
 * route's check — the tables differ per field. */
const colour = z.string().trim().min(1);

export const figureDoc = z.strictObject({
  /** Client-chosen, forever — same rule as every v2 id. */
  id: z.string().regex(ID_RE),
  /** What the owner calls this figure ("Anna", "me in winter"). */
  name: z.string().trim().min(1).optional(),
  /** The person this figure depicts, by the email people: uses. Optional —
   * a decorative figure depicts nobody. Foundation for the future "people"
   * mode; nothing reads it yet. */
  person: z.email().optional(),
  // ── appearance; absent = the renderer's default for that axis ──
  hairStyle: z.enum(HAIR_STYLES).optional(),
  outfit: z.enum(OUTFITS).optional(),
  build: z.enum(BUILDS).optional(),
  age: z.enum(AGES).optional(),
  skin: colour.optional(),
  hair: colour.optional(),
  eyes: colour.optional(),
  shirt: colour.optional(),
  pants: colour.optional(),
  pack: colour.optional(),
  headscarf: colour.optional(),
  accessories: z.array(z.enum(ACCESSORIES)).optional(),
});

/**
 * How a set of figures is chosen, on the journal (the default) and on a
 * trip (which may override). `figures` ids point into /figures.
 *
 * Future, structured-for and deliberately not shipped: mode "people" — the
 * server collects the figure whose `person` matches each traveller on the
 * trip and combines them.
 */
export const journalFigures = z.union([
  z.strictObject({ mode: z.literal("off") }),
  z.strictObject({
    mode: z.literal("set"),
    figures: z.array(z.string().min(1)).min(1).max(MAX_FIGURES),
  }),
]);

export const tripFigures = z.union([
  z.strictObject({ mode: z.literal("off") }),
  /** Use the journal's own default set. */
  z.strictObject({ mode: z.literal("journal") }),
  z.strictObject({
    mode: z.literal("custom"),
    figures: z.array(z.string().min(1)).min(1).max(MAX_FIGURES),
  }),
]);

export type FigureDoc = z.infer<typeof figureDoc>;
