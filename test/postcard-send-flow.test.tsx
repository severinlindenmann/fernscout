// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * B982 — the send box, driven the way a person drives it.
 *
 * The two presses used to be two navigations, and the assertion that matters
 * is exactly that they are not any more: the confirm step arrives without the
 * page moving, and the send is one `POST` whose answer is read rather than
 * followed. The `router` is a spy for that reason — a `push` from anywhere in
 * this flow is the regression.
 *
 * `motion/react` is mocked as it is in `test/envelope-fly.test.tsx`, and for
 * the reason stated there: `useReducedMotion` caches its `matchMedia` read per
 * module instance, so a real read would be a fact about the first test in the
 * file rather than about each case.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
const refresh = vi.fn();
const push = vi.fn();

const STRINGS = {
  priceHeading: "Price",
  priceTotal: "Total",
  balance: "You have 9.",
  short: null,
  buy: "Buy credits",
  heading: "Send them?",
  body: "One card goes to the printer today.",
  confirmCost: "It costs 2 credits, leaving you 7.",
  undone: "Once it is at the printer it cannot be called back.",
  yes: "Yes, send it",
  sending: "Sending…",
  back: "Not yet",
  send: "Send 1 postcard for 2 credits",
  warning: "This prints and posts real cards.",
};

const RESULTS = {
  sent: "Sent. The cards have gone to the printer.",
  no_credits: "There are not enough credits for this order.",
};

beforeEach(() => {
  refresh.mockClear();
  push.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
  vi.unstubAllGlobals();
  vi.doUnmock("motion/react");
  vi.doUnmock("next/navigation");
  vi.resetModules();
});

async function mount(
  answer: string,
  { reduceMotion = false, sendable = true } = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ result: answer })),
  );
  vi.doMock("next/navigation", () => ({
    useRouter: () => ({ refresh, push }),
  }));
  vi.doMock("motion/react", () => ({
    useReducedMotion: () => reduceMotion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get: (_t, tag: string) => (props: Record<string, unknown>) => {
          const dom = { ...props };
          for (const key of ["initial", "animate", "exit", "transition"]) {
            delete dom[key];
          }
          const Tag = tag as "div";
          return <Tag {...(dom as React.ComponentProps<"div">)} />;
        },
      },
    ),
  }));
  const { default: PostcardSend } = await import(
    "@/app/[user]/postcards/[id]/PostcardSend"
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <PostcardSend
        username="ana"
        id="abc"
        confirming={false}
        sendable={sendable}
        statusLine={null}
        short={false}
        results={RESULTS}
        initialResult={null}
        ledger={{
          lines: [{ label: "2 credits each × 1", credits: 2, amount: "2 credits" }],
          totalCredits: 2,
          totalLabel: "2 credits",
          totalMoney: "about CHF 0.40",
        }}
        strings={STRINGS}
      />,
    );
  });
}

function click(text: string) {
  const node = [...container!.querySelectorAll("a")].find((a) =>
    a.textContent?.includes(text),
  );
  if (!node) throw new Error(`no link saying ${text}`);
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function submit() {
  const form = container!.querySelector("form") as HTMLFormElement;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function confirmAndSend() {
  click(STRINGS.send);
  await submit();
}

function envelope(): SVGElement | null {
  return container!.querySelector('svg[aria-hidden="true"]');
}

describe("pressing send", () => {
  test("the first press only asks, and asks in place", async () => {
    await mount("sent");
    expect(container!.textContent).not.toContain(STRINGS.heading);
    click(STRINGS.send);
    expect(container!.textContent).toContain(STRINGS.heading);
    // Nothing has been posted, and the page has not moved.
    expect(fetch).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  test("a send is one POST, and its answer is read rather than followed", async () => {
    await mount("sent");
    await confirmAndSend();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("/ana/postcards/abc/send");
    expect(init.method).toBe("POST");
    expect(push).not.toHaveBeenCalled();
    expect(container!.textContent).toContain(RESULTS.sent);
    // The heading, the intro and the back are server-rendered from the order
    // and are now stale — this is what brings them up to date in place.
    expect(refresh).toHaveBeenCalled();
  });

  test("the envelope leaves on the press, and not before", async () => {
    await mount("sent");
    click(STRINGS.send);
    expect(envelope()).toBeNull();
    await submit();
    expect(envelope()).not.toBeNull();
  });

  test("under prefers-reduced-motion nothing flies, and it still sends", async () => {
    await mount("sent", { reduceMotion: true });
    await confirmAndSend();
    expect(envelope()).toBeNull();
    expect(container!.textContent).toContain(RESULTS.sent);
  });

  test("a refusal is said out loud and leaves the button there", async () => {
    await mount("no_credits");
    await confirmAndSend();
    expect(container!.textContent).toContain(RESULTS.no_credits);
    expect(container!.textContent).toContain(STRINGS.send);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a send that never arrives does not claim to have sent", async () => {
    await mount("sent");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await confirmAndSend();
    expect(container!.textContent).not.toContain(RESULTS.sent);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("with nothing sendable the button cannot be pressed", async () => {
    await mount("sent", { sendable: false });
    click(STRINGS.send);
    expect(container!.textContent).not.toContain(STRINGS.heading);
  });
});
