/**
 * "Day by voice" — B2194. Client-safe: the choice's values, the guided
 * questions, and how the answers become a day's text.
 */

/** "How do you like to tell it?" — asked once, changeable in Journal settings. */
export const TELL_BY = ["photos", "speak", "type"] as const;
export type TellBy = (typeof TELL_BY)[number];

export function isTellBy(value: unknown): value is TellBy {
  return (TELL_BY as readonly unknown[]).includes(value);
}

/** One question per screen, in this order. `did` is asked with a real photo
 *  fact when there is one (`studio.day.speak.q.didPhotos`). */
export const SPEAK_QUESTIONS = ["how", "did", "ate", "met", "funny"] as const;
export type SpeakQuestion = (typeof SPEAK_QUESTIONS)[number];

/**
 * The day's text: the person's own (corrected) answers, one paragraph each,
 * in the order asked. A skipped or empty answer is left out. No question text
 * and nothing else is ever added.
 */
export function assembleSpokenDay(answers: Partial<Record<SpeakQuestion, string>>): string {
  return SPEAK_QUESTIONS.map((q) => (answers[q] ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}
