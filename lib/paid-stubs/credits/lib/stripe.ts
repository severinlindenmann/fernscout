// Public stub: Stripe is not included in this build.
export function stripeMode(): "test" | "live" | null {
  return null;
}
export function stripeProblem(): string | null {
  return "not included in this build";
}
export function stripeEnabled(): boolean {
  return false;
}
