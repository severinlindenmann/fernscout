/**
 * Preview's "✦ Suggest" state (B2677, item 2) — dashed suggestion cards,
 * nothing applied until tapped. Pure initial state plus the two "apply"
 * steps, so the rule ("the title stays the date until a chip is picked,
 * captions are off until 'Add captions', spelling stays untouched until
 * Accept") is one small module a test can hold to rather than scattered
 * `useState` defaults a later edit could quietly change.
 */
export type SuggestionState = {
  /** `null` — "Keep the date", selected by default. A real title only once
   *  the owner taps a chip. */
  titleChoice: string | null;
  captionsOn: boolean;
  spellingApplied: boolean;
};

export function initialSuggestionState(): SuggestionState {
  return { titleChoice: null, captionsOn: false, spellingApplied: false };
}

export function pickTitle(state: SuggestionState, title: string | null): SuggestionState {
  return { ...state, titleChoice: title };
}

export function addCaptions(state: SuggestionState): SuggestionState {
  return { ...state, captionsOn: true };
}

export function acceptSpelling(state: SuggestionState): SuggestionState {
  return { ...state, spellingApplied: true };
}

export function undoSpelling(state: SuggestionState): SuggestionState {
  return { ...state, spellingApplied: false };
}
