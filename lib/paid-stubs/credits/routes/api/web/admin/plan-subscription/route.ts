// Public stub: Stripe billing is not included in this build.
const notIncluded = (): Response => new Response(null, { status: 404 });
export { notIncluded as POST };
