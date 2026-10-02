/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: vouchers are not included in this build. Nobody has one, so
// nothing offers a discount — the same "absent, not broken" posture every
// optional capability takes.
export type VoucherKind = "photobook" | "postcard" | "print";
export type VoucherSource = "app-upgrade" | "promotion" | "admin";

export type Voucher = {
  id: string;
  owner: string | null;
  code: string | null;
  appliesTo: VoucherKind;
  amountRappen: number;
  source: VoucherSource;
  sourceRef: string | null;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  usedRef: string | null;
};

export async function availableVouchers(_owner: string, _kind: VoucherKind): Promise<Voucher[]> {
  return [];
}

export async function bestVoucherFor(
  _owner: string,
  _kind: VoucherKind,
  _totalRappen: number,
): Promise<{ voucher: Voucher; discountRappen: number } | null> {
  return null;
}

export async function markVoucherUsed(_id: string, _ref: string): Promise<boolean> {
  return false;
}
