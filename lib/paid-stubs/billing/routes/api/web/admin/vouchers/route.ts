// Public stub: vouchers are not included in this build.
const notIncluded = (): Response => new Response(null, { status: 404 });
export { notIncluded as GET, notIncluded as POST, notIncluded as DELETE };
