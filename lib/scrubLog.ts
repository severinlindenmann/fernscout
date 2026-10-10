/**
 * Make untrusted text safe to put in one log line (B-2953): no email, coordinate pair, token,
 * long opaque run or query string survives, no line break can forge a second
 * line, and the result is at most `max` characters. Pure; reusable by any
 * logger that prints text a client chose.
 */
export function scrubLog(text: string, max: number): string {
  const out = text
    .replace(/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, "[coords]")
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\bfs_[\w-]+/g, "[redacted]")
    .replace(/\?[^\s"'`)]*/g, "?[query]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[redacted]")
    .replace(/[A-Za-z0-9+_=]{24,}/g, "[redacted]")
    // URL-safe tokens may hold "-" and "/", and so do slugs and routes. A slug
    // is lowercase; a token that mixes upper case with a digit is not one.
    .replace(/[A-Za-z0-9+/_=-]{24,}/g, (run) => (/[A-Z]/.test(run) && /\d/.test(run) ? "[redacted]" : run))
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, " ");
  return out.length > max ? out.slice(0, max) : out;
}
