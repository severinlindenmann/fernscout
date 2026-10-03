/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: print orders and Stannp are not included in this build, so the
// operator's Providers section has no Stannp row and no orders card.
export function providersModule(): boolean {
  return false;
}
export function stannpKeySet(): boolean {
  return false;
}
export async function fetchStannpBalance(): Promise<{ value: number; currency: string | null }> {
  throw new Error("not included in this build");
}
export type OperatorOrder = {
  id: string;
  owner: string;
  kind: "postcard" | "photobook";
  status: string;
  createdAt: string;
  attention: string | null;
};
export function readOperatorOrder(_row: {
  id: string;
  owner_id: string;
  kind: string;
  status: string;
  provider: string;
  created_at: string;
  payload: string;
}): OperatorOrder {
  throw new Error("not included in this build");
}
export async function listOperatorOrders(_limit = 30): Promise<OperatorOrder[]> {
  return [];
}
