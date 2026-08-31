import path from "node:path";

/**
 * Where the markdown lives.
 *
 * Read on every call rather than captured once, so tests can point at a
 * fixture directory without reloading modules. Set CONTENT_DIR to override.
 */
export function contentRoot(): string {
  return process.env.CONTENT_DIR ?? path.join(process.cwd(), "content");
}
