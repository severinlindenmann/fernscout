"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * The three questions, as three tabs — B996 (decision 1B).
 *
 * `/admin` was one scroll of nine screens on a phone, and the thing it was
 * opened for was rarely the first. It is opened standing up, usually to answer
 * one of *what is this costing me*, *who is using it*, and *is anything
 * broken* — so those are the three, and each is one screen.
 *
 * **The bar is at the bottom on a phone and at the top on a desktop.** A phone
 * is held near its lower edge and a mouse is not; a control pinned to the top
 * of a touch screen is the one place a thumb cannot reach without regripping.
 *
 * **The tab is in the URL.** Without that, every reload and every mailed link
 * lands on Money, which makes a bookmark to the health of the instance
 * impossible — and a page whose state cannot be linked to is a page you cannot
 * send to yourself. A hash rather than a query, because it is a position in a
 * document rather than a request to the server, and it costs no navigation.
 *
 * The queue lives *above* this component and outside the tabs, always. It is
 * the only thing on the page that is a person waiting rather than a number,
 * and hiding it behind a tab would make its emptiness a fact you have to go
 * and check.
 */

export type Tab = {
  id: string;
  label: string;
  /** Shown beside the label when non-zero — how many things there need you. */
  badge?: number;
  panel: ReactNode;
};

/**
 * Everything currently watching the hash — see `useHash`.
 *
 * `history.replaceState` deliberately does *not* fire `hashchange`, so a tab
 * pressed here has to tell its own subscribers. A module-level set rather than
 * a context: there is one console on the page and there will not be two.
 */
const WATCHING = new Set<() => void>();

/**
 * The tab named in the URL, as a value rather than as state.
 *
 * `useSyncExternalStore` and not `useState` + `useEffect`, for two reasons
 * that are the same reason: the hash is the browser's state and not ours.
 * Copying it into `useState` during render is a hydration mismatch — the
 * server has no `location` — and copying it in an effect is a second render
 * of the whole page after the first, which is what
 * `react-hooks/set-state-in-effect` is pointing at. The third argument is the
 * server's answer, which is "no hash", which is the first tab.
 */
function useHash(): string {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      WATCHING.add(onChange);
      return () => {
        window.removeEventListener("hashchange", onChange);
        WATCHING.delete(onChange);
      };
    },
    () => window.location.hash.slice(1),
    () => "",
  );
}

export default function Console({ tabs }: { tabs: Tab[] }) {
  const hash = useHash();
  const active = tabs.some((tab) => tab.id === hash) ? hash : (tabs[0]?.id ?? "");

  function go(id: string) {
    // `replaceState` rather than assigning `location.hash`: the second one
    // scrolls to whatever it matched, which on this page means jumping past
    // the queue the operator was meant to see. It also keeps the back button
    // meaning "leave /admin" rather than "undo three taps".
    window.history.replaceState(null, "", `#${id}`);
    for (const tell of WATCHING) tell();
  }

  const bar = (
    <div className="flex gap-1 rounded-full border border-navy-200 bg-white p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-pressed={active === tab.id}
          onClick={() => go(tab.id)}
          className={`min-h-11 flex-1 rounded-full px-3 text-sm font-semibold transition-colors ${
            active === tab.id
              ? "bg-navy-900 text-white"
              : "text-navy-700 hover:bg-cream-100"
          }`}
        >
          {tab.label}
          {tab.badge ? (
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-xs ${
                active === tab.id ? "bg-white text-navy-900" : "bg-coral-600 text-white"
              }`}
            >
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* Desktop: above the content, where a heading would be. */}
      <div className="mt-6 hidden sm:block">{bar}</div>

      {/* The panels are all rendered and all but one hidden, rather than
          swapped. They were rendered on the server in one pass — throwing away
          the two you are not looking at would mean fetching them again on
          every tap. `hidden` also keeps the browser's own find-in-page honest
          about which one it searched. */}
      {tabs.map((tab) => (
        <div key={tab.id} hidden={tab.id !== active}>
          {tab.panel}
        </div>
      ))}

      {/* Phone: pinned to the bottom, in the thumb's reach. `pb-24` on the
          page below is what keeps the last row of content clear of it. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-navy-200 bg-cream-50/95 p-2 backdrop-blur sm:hidden">
        {bar}
      </div>
    </>
  );
}
