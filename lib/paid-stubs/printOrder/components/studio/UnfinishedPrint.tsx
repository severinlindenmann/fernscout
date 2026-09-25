/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: printed orders are not included in this build, so there is
// never an unfinished one to name.
import { Send } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import type { UnfinishedPrint as Item } from "../../lib/orders";

type T = (key: TranslationKey, vars?: Record<string, string>) => string;

export function unfinishedTitle(_item: Item, _t: T, _locale: string): string {
  return "";
}
export const unfinishedIcon = (_item: Item) => Send;
