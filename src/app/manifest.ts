import type { MetadataRoute } from "next";
import { getAssetVersion } from "@/lib/assetVersion";

export default function manifest(): MetadataRoute.Manifest {
  const v = getAssetVersion();
  return {
    name: "재고관리",
    short_name: "재고관리",
    start_url: "/products",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      {
        src: `/icons/icon-192.png?v=${v}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-512.png?v=${v}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
