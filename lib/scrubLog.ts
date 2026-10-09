/**
 * Make untrusted text safe to put in one log line (B-2953): no email, token,
 * long opaque run or query string survives, no line break can forge a second
 * line, and the result is at most `max` characters. Pure; reusable by any
 * logger that prints text a client chose.
 */
export function scrubLog(text: string, max: number): string {
  const out = text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bfs_[\w-]+/g, "[redacted]")
    .replace(/\?[^\s"'`)]*/g, "?[query]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]")
    // Opaque runs only: "/" and "-" are left out so a route or slug survives.
    .replace(/[A-Za-z0-9+_=]{24,}/g, "[redacted]")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  return out.length > max ? out.slice(0, max) : out;
}
