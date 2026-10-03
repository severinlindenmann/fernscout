// Public stub: Group trips are part of the paid edition.
import { notFound } from "next/navigation";
export default function NotIncluded(): never { notFound(); }
export async function generateMetadata(): Promise<Record<string, never>> { return {}; }
