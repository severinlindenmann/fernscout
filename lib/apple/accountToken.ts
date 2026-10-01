import "server-only";
import { createHash } from "node:crypto";

/**
 * A stable UUID for an owner id, used as StoreKit's `appAccountToken` —
 * B2598. Apple ties a purchase to whatever UUID the app hands `purchase()`;
 * we never invent a new one to store, we derive it, so the server can
 * recompute the same value from the URL's `user` and refuse a transaction
 * whose token names somebody else's journal, with nothing to look up.
 *
 * A plain UUID v5 (SHA-1 of a namespace + the owner id, RFC 4122 ยง4.3) — not
 * a cryptographic secret, just a deterministic, collision-resistant mapping,
 * so the standard construction is the whole thing.
 */
const NAMESPACE_UUID = "6f7b0f0e-6e8a-4b3e-9f0c-2f2a9b6a8c11"; // this app's fixed namespace, chosen once

export function appAccountTokenFor(owner: string): string {
  const namespaceBytes = Buffer.from(NAMESPACE_UUID.replace(/-/g, ""), "hex");
  const nameBytes = Buffer.from(owner, "utf8");
  const hash = createHash("sha1").update(Buffer.concat([namespaceBytes, nameBytes])).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
