import "server-only";
import type { Metadata } from "next";
import { ogCard } from "@/components/OgCard";
import { pickLocale } from "./contacts/locale";
import { ogLocale, translateIn } from "./locales";
import { serverSite } from "./site";

/**
 * What a link preview of an invite shows — B2502.
 *
 * A join link (`/j/<code>`) or a welcome link (`/w/<code>`) pasted into
 * WhatsApp unfurled as "Not found" over the landing's card, which reads as
 * broken or as spam to the grandparent it was sent to. The preview now says
 * it is an invitation, names the journal and nothing else — the title is the
 * one thing the page itself already shows anybody holding the link — and is
 * written in the journal's language, because a preview bot sends no
 * `Accept-Language`. An unknown, expired or stopped code gets a neutral card
 * that names no journal, so the preview says no more about a code than the
 * page does.
 */
export type InviteSubject = { title: string; locale: string } | null;

/** The journal side of a resolved invite: its title, and the language the
 * owner set on the invite, else the journal's own. */
export function inviteSubject(
  user: { title: string; defaultLocale: string } | null | undefined,
  inviteLocale?: string | null,
): InviteSubject {
  if (!user) return null;
  return { title: user.title, locale: pickLocale(inviteLocale, user.defaultLocale) };
}

/** Title, description and card for the page at `path` (`/j/<code>`). Always
 * noindex, and the referrer is not passed on. */
export function inviteMetadata(path: string, subject: InviteSubject): Metadata {
  const locale = subject?.locale ?? "en";
  const title = subject
    ? translateIn(locale, "invitePreview.title", { title: subject.title })
    : translateIn(locale, "invitePreview.neutralTitle");
  const description = translateIn(locale, subject ? "invitePreview.description" : "invitePreview.neutralDescription");
  const image = { url: `${path}/og.png`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    openGraph: { type: "website", url: path, locale: ogLocale(locale), title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

/** The 1200×630 card: the mark, the instance's name, "Invitation to read
 * along" and the journal's title — or only "Invitation" for a code that does
 * not resolve. Drawn by the landing's own card, never redrawn. */
export function inviteCard(subject: InviteSubject): Response {
  const name = serverSite().name;
  if (!subject) return ogCard({ name, line: translateIn("en", "invitePreview.neutralTitle") });
  return ogCard({
    name,
    kicker: translateIn(subject.locale, "invitePreview.kicker"),
    line: subject.title,
  });
}
