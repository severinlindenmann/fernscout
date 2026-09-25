import type { WaitlistEntry } from "@/lib/appWaitlist";

/**
 * Who is waiting for the iPhone app — B2341.
 *
 * Read-only: there is nothing to approve here, unlike `Invites` beside it —
 * an address here is not let into anything, it is a mail address to notify
 * once `features.iosApp.storeUrl` is set. No client fetch, unlike `Invites`:
 * nothing on this list changes from a button press, so a server-rendered
 * list is the whole of it.
 */
export default function AppWaitlist({ entries }: { entries: WaitlistEntry[] }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">iPhone app waitlist</h2>
      <p className="mt-1 text-sm text-ink-body">
        Addresses that asked to hear when the App Store link goes live. Set{" "}
        <code>features.iosApp.storeUrl</code> in <code>site/config.json</code> when it does — the
        landing page switches to a link and stops collecting more.
      </p>
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">Nobody is waiting yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-quiet rounded-lg border border-line-quiet">
          {entries.map((entry) => (
            <li key={entry.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="w-full min-w-0 break-words text-sm text-ink-strong sm:w-auto sm:flex-1">
                {entry.email}
              </span>
              <span className="text-xs text-ink-muted">
                {entry.createdAt.slice(0, 10)}
                {entry.locale ? ` · ${entry.locale}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
