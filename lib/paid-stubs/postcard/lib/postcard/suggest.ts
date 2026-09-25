/* eslint-disable @typescript-eslint/no-unused-vars -- a stub keeps the real signature and ignores its arguments */
// Public stub: postcards are not included in this build — nothing to suggest.
export type PostcardSuggestion = {
  kind: "postcard";
  day: string;
  trip: string;
  reason: string;
  recipients: { contactId: string; name: string; city: string; country: string | null; locale: string | null }[];
};

export async function postcardSuggestion(_user: string): Promise<PostcardSuggestion | null> {
  return null;
}
