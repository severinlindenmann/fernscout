import { ogCard, OG_SIZE } from "@/components/OgCard";
import { serverSite } from "@/lib/site";

// The card shown when the site is shared on social / chat apps. Drawn by
// components/OgCard.tsx, which the schools and tour-operator pages share.
export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = serverSite().name;

export default function OpengraphImage() {
  return ogCard({
    name: serverSite().name,
    line: "A travel journal you write yourself, or hand to an agent.",
  });
}
