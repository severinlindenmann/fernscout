import type { Metadata } from "next";
import { notFound } from "next/navigation";
import OrdersPageContent from "./OrdersPageContent";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { requestLocale, translateIn } from "@/lib/locales";
import { listAllOrders } from "@/lib/orders";

/**
 * Every photobook and postcard order an owner has proposed, in one place —
 * B1452. Both kinds already live in `print_orders`
 * (`owner_id`+`kind`+`status`); this is the first page that reads it back as
 * a list rather than by a single id already in hand.
 *
 * Owner only, `notFound()` otherwise — the same gate `/[user]/account` uses,
 * for the same reason: a refusal that told a stranger "this exists but is
 * not yours" would say more than the page is allowed to.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/orders">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "orders.title"),
    robots: { index: false, follow: false },
  };
}

export default async function OrdersPage({ params }: PageProps<"/[user]/orders">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) notFound();
  if (!(await isOwner(user))) notFound();

  const orders = await listAllOrders(user);

  return <OrdersPageContent orders={orders} />;
}
