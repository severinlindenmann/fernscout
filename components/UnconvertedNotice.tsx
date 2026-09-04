"use client";

import { TriangleAlert } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useMoney } from "./CurrencyProvider";
import type { Unconverted } from "@/lib/costFormat";

/**
 * The gap, stated plainly — wherever a money total is drawn from converted
 * costs.
 *
 * Costs whose currency the trip has no rate for are left out of every total
 * built on top of them. Saying so is the whole point: a total that quietly
 * shrinks — or, worse, one that reads as a confident zero — is a number
 * nobody can check. B353: this used to be the costs page's alone, while the
 * journal home and the trip overview drew the same excluded spend as CHF 0
 * with no caveat in sight.
 */
export default function UnconvertedNotice({ items }: { items: Unconverted[] }) {
  const { t } = useI18n();
  const { original } = useMoney();
  if (items.length === 0) return null;

  const amounts = items.map((u) => original(u.amount, u.currency)).join(", ");
  return (
    <p
      role="status"
      className="mt-4 flex items-start gap-2 rounded-xl border border-coral-400/50 bg-coral-300/25 px-3.5 py-3 text-xs leading-relaxed text-navy-900"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-coral-600" aria-hidden />
      <span>{t("cost.unconverted", { amounts })}</span>
    </p>
  );
}
