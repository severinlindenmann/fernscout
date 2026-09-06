import "server-only";
import fs from "node:fs";
import { loadUserConfig } from "../config";
import { orderDir } from "./build";
import { clearPrunedFiles, getPhotobookOrder, listPrintedOrderIds } from "./orders";

/**
 * Keep the newest `photobookOrdersPerUser` printed books on disk for a
 * journal, and delete the PDFs of the rest — B483.
 *
 * Called once, right after an order finishes printing, never before a build
 * starts: that is what keeps this from ever racing one. Only `printed` orders
 * are candidates (`listPrintedOrderIds`), so a build still in `submitted` is
 * never touched, and the order that just finished is always the newest of the
 * lot and therefore always kept. Nothing here deletes a `print_orders` row —
 * the price, the date and the page count are history and stay queryable —
 * only the megabytes of PDF come off disk, and `clearPrunedFiles` records
 * that so a page rendering the order stops offering a download that would
 * 404.
 *
 * `null` (the config's explicit opt-out) skips the walk entirely rather than
 * asking `listPrintedOrderIds` for a list nothing will ever be pruned from.
 */
export async function pruneOldPhotobooks(owner: string): Promise<void> {
  const keep = loadUserConfig(owner).media.photobookOrdersPerUser;
  if (keep === null) return;

  const ids = await listPrintedOrderIds(owner);
  for (const id of ids.slice(keep)) {
    const dir = orderDir(owner, id);
    if (!fs.existsSync(dir)) continue; // pruned already, or never built
    fs.rmSync(dir, { recursive: true, force: true });
    const order = await getPhotobookOrder(owner, id);
    if (order && !order.payload.pruned) await clearPrunedFiles(owner, id, order.payload);
  }
}
