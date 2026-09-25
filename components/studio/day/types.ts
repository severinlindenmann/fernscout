/** Shared shapes between `AddDayFlow` and its screens — kept in one place so
 *  a field added to one cannot quietly drift from the other. */

export type InboxMediaItem = {
  id: string;
  filename: string;
  bytes: number;
  uploadedAt: string;
  lat?: number;
  lon?: number;
  takenAt?: string;
  caption?: string;
  location?: string;
  country?: string;
};

export type ExistingDayOnDate = { slug: string; title: string; status: "draft" | "published" };
