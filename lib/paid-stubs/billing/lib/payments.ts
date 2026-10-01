/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: payments are not included in this build.
type PaymentStatus = "pending" | "requested" | "paid" | "refunded";
type PaymentMethod = "twint" | "card" | "admin";
export type Payment = {
  id: string;
  owner: string;
  credits: number;
  amountRappen: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  createdAt: string;
  paidAt: string | null;
  requestedAt: string | null;
  providerRef: string | null;
};

export async function listPayments(_owner: string, _limit = 8): Promise<Payment[]> {
  return [];
}
export async function paymentsAwaiting(): Promise<Payment[]> {
  return [];
}
export async function paymentsPaidSince(_since: string): Promise<Payment[]> {
  return [];
}
export function takings(_payments: Payment[]): number {
  return 0;
}
