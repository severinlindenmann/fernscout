/**
 * The Speak sheet's pure parts — B2761. Client-safe.
 *
 * The guide questions are only ever shown; nothing here, and nothing in the
 * sheet, hands a question to the day's text. What lands in the day is the
 * person's own transcript, appended after what is already there, and Undo
 * takes exactly that transcript back out again.
 */

/** Cycled by "Another question". The strings are `studio.speak.q.<id>`. */
export const SPEAK_QUESTIONS = ["how", "did", "ate", "met", "funny"] as const;

/** `said` appended after `prev`, one space between when there is text already. */
export function appendSpoken(prev: string, said: string): string {
  return prev ? `${prev} ${said}` : said;
}

/** Removes the last occurrence of `said` (and the space `appendSpoken` put
 *  before it) and nothing else. Unchanged when it is no longer there. */
export function undoSpoken(text: string, said: string): string {
  const at = text.lastIndexOf(said);
  if (at < 0) return text;
  return text.slice(0, at).replace(/ $/, "") + text.slice(at + said.length);
}

/** 72 -> "1:12" */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
