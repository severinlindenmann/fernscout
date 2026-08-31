import type { MetadataRoute } from "next";
import { serverSite } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: serverSite().name,
    short_name: serverSite().name,
    description: "",
    start_url: "/",
    display: "standalone",
    background_color: "#fffaf0",
    theme_color: "#ffd23f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
