/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: photobooks are not included in this build, so there are no
// drafts. The shape core reads (day deletion's "a draft uses this day's
// photographs" check) is a subset of paid/photobook/lib/photobook/drafts.ts.
export type PhotobookDraft = {
  trip: string;
  options: {
    days: Record<string, { photos?: string[]; hero?: string }>;
    excludePhotos: readonly string[];
    cover?: string;
    titlePhoto?: string;
    titlePhotos?: readonly string[];
  };
  createdAt: string;
  updatedAt: string;
};

export async function listDrafts(_owner: string): Promise<PhotobookDraft[]> {
  return [];
}
