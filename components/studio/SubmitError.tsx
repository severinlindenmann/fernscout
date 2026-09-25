/**
 * A studio flow's one write error — B2070. A PATCH that failed, a 422, a
 * network drop: one coral line that announces itself (`role="alert"`), at
 * the end of the body, directly above the bar that holds the button that
 * failed. Never a card elsewhere, never only at the top.
 *
 * A field-level error is not this: it is its own `role="alert"` line
 * directly under the control, which carries `aria-invalid`.
 *
 * No hooks, so a server page (StudioPage's `error`) can render it too.
 */
export default function SubmitError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-coral-600">
      {message}
    </p>
  );
}
