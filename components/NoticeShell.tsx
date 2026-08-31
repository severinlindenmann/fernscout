import Link from "next/link";

/**
 * The one shape every "something is wrong" page takes.
 *
 * Readers here are past sixty and usually arrive from a link in an email, so a
 * dead end has to answer two questions in the first two lines: *what happened*
 * and *what do I press now*. A bare 404 answers neither, and the reader's own
 * conclusion — "I broke it" — is almost always wrong.
 *
 * Strings arrive already translated, and no provider is touched, so this works
 * in three places that cannot share one: the root 404, which renders above
 * `SiteProvider`; the reader-facing pages, which read the browser's language
 * through `LocaleProvider`; and the contact pages, which must render in the
 * language stored on the contact's own record rather than the one their phone
 * happens to be set to.
 *
 * Sizes are the audience's, not the design system's: 20px body, actions 48px
 * tall. Nothing here is small print — it is the only text on the page.
 */
export type NoticeAction = { href: string; label: string };

export default function NoticeShell({
  lang,
  title,
  body,
  actions = [],
  children,
}: {
  /** Set only when the page's language is decided by data rather than by the
   * reader's browser — otherwise the document's own `lang` is already right. */
  lang?: string;
  title: string;
  body?: string;
  /** In order of likelihood, because the first one gets pressed. */
  actions?: NoticeAction[];
  children?: React.ReactNode;
}) {
  return (
    <main
      id="main"
      tabIndex={-1}
      lang={lang}
      className="mx-auto w-full max-w-xl px-6 py-20 sm:py-28"
    >
      <h1 className="font-display text-3xl font-semibold leading-tight text-navy-900 sm:text-4xl">
        {title}
      </h1>
      {body && <p className="mt-5 text-xl leading-8 text-navy-700">{body}</p>}

      {actions.length > 0 && (
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {actions.map((action, i) => (
            <Link
              key={action.href}
              href={action.href}
              className={
                // The first action is the one almost everybody wants, so it is
                // the only one that looks like a button.
                i === 0
                  ? "inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300"
                  : "inline-flex min-h-12 items-center justify-center rounded-full border border-navy-200 bg-white px-6 text-lg font-semibold text-navy-700 transition-colors hover:border-navy-500"
              }
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}

      {children}
    </main>
  );
}
