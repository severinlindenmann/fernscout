// POST /api/v2/client-error — B-2953. A browser or the iOS shell reporting a
// crash. Public, write-only, answered 204; the caps are the contract.
import { z } from "zod";

export const CLIENT_ERROR_LIMITS = { message: 500, stack: 4000, route: 200, appVersion: 40, id: 40 } as const;

const id = z.string().max(CLIENT_ERROR_LIMITS.id).regex(/^[A-Za-z0-9_-]+$/);

export const clientErrorRequest = z.strictObject({
  message: z.string().max(CLIENT_ERROR_LIMITS.message),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  route: z.string().max(CLIENT_ERROR_LIMITS.route),
  appVersion: z.string().max(CLIENT_ERROR_LIMITS.appVersion),
  platform: z.enum(["web", "ios"]),
  requestId: id.optional(),
  digest: id.optional(),
});
