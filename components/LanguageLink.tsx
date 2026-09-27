"use client";

import type { ComponentProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { languageHref, splitLanguagePath } from "@/lib/languagePaths";

/**
 * On a language address (`/de/schools`), a link to another page that has one
 * stays in that language: `/schools/demo` becomes `/de/schools/demo` — B2473.
 * Anywhere else, and for a page with no such version, the href is untouched.
 */
export function useLanguageHref(): (href: string) => string {
  const locale = splitLanguagePath(usePathname() ?? "/")?.locale;
  return (href) => languageHref(locale, href);
}

export default function LanguageLink({ href, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const to = useLanguageHref();
  return <Link href={to(href)} {...rest} />;
}
