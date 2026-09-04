/**
 * `topojson-client` ships no declarations, and `**\/*.mts` is typechecked
 * (tsconfig.json), so the one build script written in TypeScript needs this.
 * Its .mjs siblings escape tsc entirely and therefore never needed it.
 *
 * Narrow on purpose: `feature()` returns whatever the topology holds, and
 * pretending to know its shape here would be a lie the caller then trusts.
 * The caller states the shape it expects and is responsible for it.
 */
declare module "topojson-client" {
  export function feature(topology: unknown, object: unknown): unknown;
}
