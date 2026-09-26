import { Fragment, isValidElement, Suspense, type ReactNode } from "react";

/**
 * A server page's element tree with its bodies filled in — what the reader is
 * eventually sent, read without rendering it.
 *
 * Several reading pages answer in two halves (components/RouteSkeleton.tsx):
 * the page itself settles who may see what, then hands an async server
 * component doing the heavy part to a `RouteBoundary`. The tests that read a
 * page's props straight off its returned element — so that a client
 * component never has to run — would otherwise stop at that boundary.
 *
 * So: a `RouteBoundary` or a `<Suspense>` is replaced by its children (what a
 * document load gets, and what a navigation gets once the body arrives — the
 * same tree; test/route-skeleton.test.tsx holds the boundary itself), an async
 * function component (a server body; a client component is never async) is
 * called with its props and replaced by what it returns, and a fragment such
 * a body returns is replaced by its children. Everything else is kept, with
 * its children resolved the same way, so the shape a test reads is the shape
 * the page had before it grew a boundary.
 */
export async function resolveServerTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveServerTree));
  if (!isValidElement(node)) return node;
  const props = node.props as { children?: ReactNode };
  // By name rather than by identity: tests that `vi.resetModules()` before
  // importing a page hold a different copy of the component than this file
  // would import.
  const boundary = typeof node.type === "function" && node.type.name === "RouteBoundary";
  if (node.type === Suspense || boundary) return resolveServerTree(props.children);
  if (typeof node.type === "function" && node.type.constructor.name === "AsyncFunction") {
    const render = node.type as (p: unknown) => Promise<ReactNode>;
    const out = await render(node.props);
    const unwrapped =
      isValidElement(out) && out.type === Fragment ? (out.props as { children?: ReactNode }).children : out;
    return resolveServerTree(unwrapped);
  }
  if (props.children === undefined) return node;
  return { ...node, props: { ...props, children: await resolveServerTree(props.children) } } as ReactNode;
}
