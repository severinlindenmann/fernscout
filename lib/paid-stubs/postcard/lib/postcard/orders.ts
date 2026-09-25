/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: postcards are not included in this build, so there are no
// postcard orders. The order shape is the part core reads — a subset of
// paid/postcard/lib/postcard/orders.ts.
export type PostcardOrder = {
  id: string;
  owner: string;
  status: string;
  provider: string;
  payload: { trip: string | null; day: string | null; photo: string; recipients: string[]; expiresAt: string; creditsEach: number };
  createdAt: string;
  updatedAt: string;
};

export async function listOrders(_owner: string): Promise<PostcardOrder[]> {
  return [];
}
export function isExpired(order: PostcardOrder, _now = Date.now()): boolean {
  return false;
}
export function isPending(order: PostcardOrder): boolean {
  return order.status === "draft";
}
