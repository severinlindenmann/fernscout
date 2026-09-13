"use client";

import Link from "next/link";
import { BookOpen, Mail } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import { useI18n } from "@/components/LocaleProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { OrderRow } from "@/lib/orders";

const KIND_ICON = { postcard: Mail, photobook: BookOpen } as const;

/** One row, shared with the preview on `/account` — B1452. */
export function OrderListItem({ order }: { order: OrderRow }) {
  const { t } = useI18n();
  const site = useSite();
  const Icon = KIND_ICON[order.kind];
  const href =
    order.kind === "postcard"
      ? `${site.base}/postcards/${order.id}`
      : `${site.base}/photobooks/${order.id}`;
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-surface-base sm:px-6"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-300/50 text-ink-strong">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-ink-strong">
            {t(`orders.kind.${order.kind}` as TranslationKey)}
          </p>
          <p className="text-sm tabular-nums text-ink-secondary">
            {order.createdAt.slice(0, 10)} · {order.chf}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-line-quiet bg-surface-base px-3 py-1 text-sm font-semibold text-ink-body">
          {t(`orders.status.${order.status}` as TranslationKey)}
        </span>
      </Link>
    </li>
  );
}

export default function OrdersPageContent({ orders }: { orders: OrderRow[] }) {
  const { t } = useI18n();

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8"
      >
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-strong sm:text-4xl">
          {t("orders.title")}
        </h1>

        {orders.length === 0 ? (
          <p className="mt-6 text-base text-ink-secondary">{t("orders.empty")}</p>
        ) : (
          <ul className="mt-6 divide-y divide-line-quiet rounded-2xl border border-line-quiet bg-surface-raised">
            {orders.map((order) => (
              <OrderListItem key={`${order.kind}-${order.id}`} order={order} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
