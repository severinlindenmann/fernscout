/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: printed orders are not included in this build.
export type OrderRow = {
  id: string;
  kind: "postcard" | "photobook";
  status: string;
  createdAt: string;
  chf: string;
};
export type UnfinishedPrint =
  | { kind: "postcard"; id: string; href: string; recipients: string[]; updatedAt: string }
  | { kind: "photobook"; trip: string; tripTitle: string; href: string; updatedAt: string };

export async function listAllOrders(_owner: string): Promise<OrderRow[]> {
  return [];
}
export async function listUnfinished(_owner: string): Promise<UnfinishedPrint[]> {
  return [];
}
