/**
 * Preview's own review state — B2677 item 2, rebuilt on compose for B2689.
 * Nothing composed is ever applied until the owner taps "Use this"; the
 * title stays the date until a chip is picked.
 */
export type SuggestionState = {
  /** `null` — "Keep the date", selected by default. A real title only once
   *  the owner taps a chip. */
  titleChoice: string | null;
  /** Which composed variant's text (if any) is currently applied to this
   *  part — "Use this"/"Keep mine", undo available by setting this back to
   *  `null`. */
  composeApplied: "close" | "story" | null;
};

export function initialSuggestionState(): SuggestionState {
  return { titleChoice: null, composeApplied: null };
}

export function pickTitle(state: SuggestionState, title: string | null): SuggestionState {
  return { ...state, titleChoice: title };
}

export function applyCompose(state: SuggestionState, variant: "close" | "story"): SuggestionState {
  return { ...state, composeApplied: variant };
}

export function undoCompose(state: SuggestionState): SuggestionState {
  return { ...state, composeApplied: null };
}
