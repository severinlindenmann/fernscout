import "server-only";

/**
 * The registry's one public face — B1042.
 *
 * Fourteen files import `@/lib/helper/tools`, and every one of them still
 * does: a directory with an index resolves to the same specifier a single
 * file did, so splitting nine hundred lines into areas changed no caller.
 *
 * What is exported here is what the rest of the product is allowed to know
 * about: the tools, how to run one, and how to build a proposal. The
 * resolvers and the argument shapes are deliberately not — they are how a
 * tool is written, not how one is used, and a caller reaching for
 * `resolveTrip` is a caller doing the registry's job somewhere else.
 */
export { AREAS, TOOLS, type AreaKey } from "./registry";
export { proposalFor, runTool, toolList, toolSchemas, writeTool } from "./run";
/**
 * The types are **not** re-exported here — knip is right that nobody outside
 * imports them, and a barrel that re-exports everything is a barrel that stops
 * saying anything about what the outside is meant to use. A file that genuinely
 * needs the contract imports it from `./types` and is, by construction, part of
 * the registry.
 */
