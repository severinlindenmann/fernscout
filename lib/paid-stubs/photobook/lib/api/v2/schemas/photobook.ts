// Public stub: photobooks are not included in this build, so the photobook
// draft documents describe nothing. Same export names as
// paid/photobook/lib/api/v2/schemas/photobook.ts.
import { z } from "zod";

export const PHOTOBOOK_LIMITS: Readonly<Record<string, number>> = {};
export const photobookOptions = z.strictObject({});
export const photobookDraftWrite = z.strictObject({ options: photobookOptions });
export const photobookDraftDoc = z.strictObject({ options: photobookOptions });
export const PHOTOBOOK_OPTION_KEYS: string[] = [];
export const PHOTOBOOK_DEFAULT_KEYS: readonly string[] = [];
export type PhotobookDraftWrite = z.infer<typeof photobookDraftWrite>;
export type PhotobookDraftDoc = z.infer<typeof photobookDraftDoc>;
