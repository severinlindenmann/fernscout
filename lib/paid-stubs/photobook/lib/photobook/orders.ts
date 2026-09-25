/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: photobooks are not included in this build, so there are no
// photobook orders. The order shape is the part core reads (storage cleanup,
// moving a day) — a subset of paid/photobook/lib/photobook/orders.ts.
export type PhotobookPayload = {
  trip: string;
  options: {
    days: Record<string, { photos?: string[]; hero?: string }>;
    excludePhotos: readonly string[];
    cover?: string;
    titlePhoto?: string;
    titlePhotos?: readonly string[];
  };
  pages: number;
  volumes: number;
  credits: number;
  files?: string[];
  pruned?: true;
};
export type PhotobookOrder = {
  id: string;
  owner: string;
  status: string;
  payload: PhotobookPayload;
  createdAt: string;
  updatedAt: string;
};

export async function getPhotobookOrder(_owner: string, _id: string): Promise<PhotobookOrder | null> {
  return null;
}
export async function listPhotobookOrders(_owner: string): Promise<PhotobookOrder[]> {
  return [];
}
export async function listPrintedOrderIds(_owner: string): Promise<string[]> {
  return [];
}
export async function clearPrunedFiles(_owner: string, _id: string, _payload: PhotobookPayload): Promise<void> {}
