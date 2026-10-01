// Public stub: granting a plan is not included in this build.
const notIncluded = (): Response => new Response(null, { status: 404 });
export { notIncluded as GET, notIncluded as POST, notIncluded as DELETE, notIncluded as PATCH };
