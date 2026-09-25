"use client";

import { useSyncExternalStore } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { nativeAppVersion, useNativeShell } from "@/components/nativeShell";

/** What the server that rendered this page was built from. */
export type BuildInfo = { version: string; commit?: string };

/** `site.hosting` — the operator's words about one host (lib/config.ts). */
export type Hosting = { host: string; where: string; translations?: Record<string, string> };

/** The reader's locale, then its language, then the operator's `where` —
 * the same pick `bannerFor` makes for the landing notice. */
function whereIn(hosting: Hosting, locale: string): string {
  const translations = hosting.translations ?? {};
  return translations[locale] ?? translations[locale.split("-")[0]] ?? hosting.where;
}

type Reached = { host: string; secure: boolean };

/** Never changes during a page's life, so there is nothing to subscribe to. */
const noSubscribe = () => () => {};

/**
 * Which version is running here, and which server it is talking to — the
 * last thing on `/me`, for everybody.
 *
 * The host is read off `location` rather than handed down from the server:
 * the question is which server *this browser* reached, and a request's own
 * `Host` header answers a different one behind a proxy. `hosting` is the
 * operator's own statement about one host (`site.hosting`); it is repeated
 * only when that is the host reached over https. Anything else — a fork that
 * kept this repository's config, a local checkout — is called self-hosted and
 * never given a place.
 */
export default function ConnectionInfo({
  build,
  hosting,
}: {
  build: BuildInfo;
  hosting?: Hosting;
}) {
  const { t, locale } = useI18n();
  const native = useNativeShell();
  const app = native ? nativeAppVersion() : undefined;
  // Serialised as one string so the snapshot is stable between reads.
  const reachedKey = useSyncExternalStore(
    noSubscribe,
    () => `${location.protocol === "https:" ? "s" : "p"}${location.host}`,
    () => "",
  );
  const reached: Reached | undefined = reachedKey
    ? { secure: reachedKey[0] === "s", host: reachedKey.slice(1) }
    : undefined;

  const web = build.commit ? `${build.version} (${build.commit})` : build.version;

  let server: string | undefined;
  if (reached) {
    const described = hosting && reached.host.toLowerCase() === hosting.host;
    server =
      described && reached.secure
        ? t("me.connectionOfficial", { host: reached.host, where: whereIn(hosting, locale) })
        : t(reached.secure ? "me.connectionSelfHosted" : "me.connectionSelfHostedPlain", {
            host: reached.host,
          });
  }

  return (
    <section aria-labelledby="connection-title" className="mt-8 border-t border-line-quiet pt-6">
      <h2 id="connection-title" className="font-display text-xl font-semibold text-ink-strong">
        {t("me.connectionTitle")}
      </h2>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base leading-7">
        {app && (
          <>
            <dt className="text-ink-secondary">{t("me.connectionApp")}</dt>
            <dd className="text-ink-body tabular-nums">
              {app.build ? `${app.version} (${app.build})` : app.version}
            </dd>
          </>
        )}
        <dt className="text-ink-secondary">{t("me.connectionWeb")}</dt>
        <dd className="text-ink-body tabular-nums">{web}</dd>
      </dl>
      {server && <p className="mt-3 text-base leading-7 text-ink-body">{server}</p>}
    </section>
  );
}
