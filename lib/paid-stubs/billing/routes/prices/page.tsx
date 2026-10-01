import { notFound } from "next/navigation";
// Public stub: this feature is not included in this build.
export default function NotIncluded(): never {
  notFound();
}
export async function generateMetadata(): Promise<Record<string, never>> {
  return {};
}
