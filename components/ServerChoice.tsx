"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useI18n } from "@/components/LocaleProvider";
import {
  chooseServer,
  resetServer,
  serverChoiceError,
  serverChoiceStatus,
  useNativeShell,
  type ServerChoiceError,
  type ServerChoiceStatus,
} from "@/components/nativeShell";

const ERROR_KEYS = {
  invalid: "landing.server.error.invalid",
  notFernscout: "landing.server.error.notFernscout",
  unreachable: "landing.server.error.unreachable",
  recording: "landing.server.error.recording",
} as const satisfies Record<ServerChoiceError, string>;

function hostOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Bring your own server, at the foot of the landing page — iPhone app only.
 *
 * Signed out, it offers to point the app at the reader's own Fernscout:
 * paste an address, the app checks something there answers as a Fernscout,
 * the owner confirms on a native dialog, and the app restarts on that
 * server. Signed in, the choice has been made, so all that is left is one
 * quiet line naming the server the app is talking to.
 *
 * Nothing in a browser: a web page cannot choose which server it came from.
 * An app built before `ServerChoicePlugin` existed rejects `status`, and the
 * section is absent rather than a form that cannot work.
 */
export default function ServerChoice({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const native = useNativeShell();
  const [status, setStatus] = useState<ServerChoiceStatus | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ServerChoiceError | null>(null);

  useEffect(() => {
    if (!native) return;
    let live = true;
    serverChoiceStatus()
      .then((s) => live && setStatus(s))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [native]);

  if (!native || !status?.host) return null;

  const host = status.host;
  const defaultHost = hostOf(status.defaultServer);

  if (signedIn) {
    return (
      <p className="mt-6 text-center text-xs leading-5 text-ink-secondary">
        {t("landing.server.connected", { host })}
      </p>
    );
  }

  // `{host}` stays a placeholder: the plugin fills it in from the address
  // it will really use, so the dialog cannot be told a different one.
  const confirm = {
    confirmTitle: t("landing.server.confirmTitle"),
    confirmBody: t("landing.server.confirmBody", { host: "{host}" }),
    confirmLabel: t("landing.server.confirmLabel", { host: "{host}" }),
    cancelLabel: t("landing.server.cancel"),
  };

  async function connect(event: FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await chooseServer(url.trim(), {
        ...confirm,
        unreachableTitle: t("landing.server.unreachableTitle"),
        unreachableBody: t("landing.server.unreachableBody", { host: "{host}" }),
        retryLabel: t("landing.server.retry"),
        resetLabel: t("landing.server.reset", { host: "{host}" }),
      });
    } catch (e) {
      setError(serverChoiceError(e));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await resetServer(confirm);
    } catch (e) {
      setError(serverChoiceError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10 border-t border-line-quiet pt-8" aria-labelledby="server-choice-title">
      <h2 id="server-choice-title" className="font-display text-base font-semibold text-ink-strong">
        {t("landing.server.title")}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-body">
        {t("landing.server.body", { host: defaultHost || host })}
      </p>
      {status.custom && (
        <p className="mt-3 text-sm leading-6 text-ink-body">
          {t("landing.server.connected", { host })}{" "}
          <button
            type="button"
            onClick={() => void reset()}
            disabled={busy}
            className="min-h-11 font-semibold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4 disabled:opacity-50"
          >
            {t("landing.server.reset", { host: defaultHost })}
          </button>
        </p>
      )}
      <form onSubmit={(e) => void connect(e)} className="mt-3 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="server-choice-url" className="sr-only">
          {t("landing.server.label")}
        </label>
        <input
          id="server-choice-url"
          // Text rather than `url`, which would refuse a bare `travel.example.org`;
          // the plugin adds `https://` itself. `inputMode` keeps the URL keyboard.
          type="text"
          inputMode="url"
          enterKeyHint="go"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="https://travel.example.org"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="min-h-11 flex-1 rounded-xl border border-line-quiet bg-surface-raised px-3 text-base text-ink-strong
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        />
        <button
          type="submit"
          disabled={busy || !url.trim()}
          className="min-h-11 rounded-full border border-line-quiet px-4 text-sm font-semibold text-ink-body
                     transition-colors hover:border-line-prominent disabled:opacity-50"
        >
          {busy ? t("landing.server.checking") : t("landing.server.connect")}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {t(ERROR_KEYS[error])}
        </p>
      )}
    </section>
  );
}
