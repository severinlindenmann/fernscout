import { useSyncExternalStore } from "react";

/**
 * A stand-in for `next/navigation` with a real history stack, for flows on
 * `useStep` (the step is `?step=`): `push` adds an entry and re-renders every
 * `useSearchParams` reader, `back` pops one, `replace` swaps the top.
 *
 *   vi.mock("next/navigation", async () => (await import("./fixtures/fakeNavigation")).navigationMock("/alex/studio/day/new"));
 */
let history: string[] = [""];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const top = () => history[history.length - 1];

/** Start a test at `search` (without the "?"), with no history behind it. */
export function resetNavigation(search = "") {
  history = [search];
  emit();
}

/** The current query string, without the "?". */
export const currentSearch = top;

export function navigationMock(pathname: string) {
  return {
    useRouter: () => ({
      push: (href: string) => {
        history.push(href.split("?")[1] ?? "");
        emit();
      },
      replace: (href: string) => {
        history[history.length - 1] = href.split("?")[1] ?? "";
        emit();
      },
      back: () => {
        if (history.length > 1) history.pop();
        emit();
      },
      refresh: () => {},
    }),
    usePathname: () => pathname,
    useSearchParams: () => new URLSearchParams(useSyncExternalStore(subscribe, top, top)),
  };
}
