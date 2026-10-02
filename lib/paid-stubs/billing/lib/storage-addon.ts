/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: the Plus +10 GB storage add-on is not included in this
// build. No owner ever has a live add-on, so `storageQuota.ts`'s
// `purchasedBytes` reads as 0 — the same "absent, not broken" posture every
// optional capability takes.
export type StorageAddon = {
  id: string;
  owner: string;
  providerRef: string | null;
  startsAt: string;
  endsAt: string;
  status: "active" | "ended" | "refunded";
  cancelAtPeriodEnd: boolean;
};

export async function liveStorageAddon(_owner: string): Promise<StorageAddon | null> {
  return null;
}

export type GrantStorageAddonInput = { owner: string; providerRef: string; startsAt: string; endsAt: string };
export type GrantStorageAddonResult = { ok: true; id: string } | { ok: false; reason: "no_database" | "duplicate" };

export async function grantStorageAddon(_input: GrantStorageAddonInput): Promise<GrantStorageAddonResult> {
  return { ok: false, reason: "no_database" };
}

export async function extendStorageAddonPeriod(_providerRef: string, _endsAt: string): Promise<boolean> {
  return false;
}

export async function endStorageAddonByProviderRef(_providerRef: string): Promise<boolean> {
  return false;
}

export async function refundStorageAddonByProviderRef(_providerRef: string): Promise<boolean> {
  return false;
}

export async function setStorageAddonCancelAtPeriodEnd(_providerRef: string, _cancel: boolean): Promise<void> {}

export async function endLiveStorageAddonForOwner(_owner: string): Promise<void> {}
