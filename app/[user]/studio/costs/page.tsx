import { permanentRedirect } from "next/navigation";

/**
 * The old statement upload — B1797, moved here by B1825, retired by B2083.
 * It read a statement through a different endpoint with a different consent
 * model and wrote nothing; `/studio/statement` (`StatementFlow`) reads the
 * same file and files the costs. The address stays so an old bookmark lands
 * on the flow that does the job. No owner check: `/studio/statement` is the
 * one place that decides who may see it.
 */
export default async function StudioCostsRedirectPage({ params }: PageProps<"/[user]/studio/costs">) {
  const { user } = await params;
  permanentRedirect(`/${user}/studio/statement`);
}
