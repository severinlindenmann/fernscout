// POST .../trips/{trip}/rename — B2015.
import { z } from "zod";
import { tripId } from "./shared";

export const tripRenameRequest = z.strictObject({
  id: tripId,
});

export const tripRenameResult = z.strictObject({
  ok: z.literal(true),
  /** The new address — GET the trip at its own id from here on. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
});
