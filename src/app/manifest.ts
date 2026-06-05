import type { MetadataRoute } from "next";
import { getAssetVersion } from "@/lib/assetVersion";

type ManifestIcon = NonNullable<MetadataRoute.Manifest["icons"]>[number];

function manifestIcon(path: string, sizes: string, purpose: ManifestIcon["purpose"], v: string): ManifestIcon {
  return {
    src: `${path}?v=${v}`,
    sizes,
    type: "image/png",
    purpose,
  };
}

export default function manifest(): MetadataRoute.Manifest {
  const v = getAssetVersion();
  const icons: ManifestIcon[] = [
    manifestIcon("/icons/icon-192.png", "192x192", "any", v),
    manifestIcon("/icons/icon-512.png", "512x512", "any", v),
    manifestIcon("/icons/icon-192.png", "192x192", "maskable", v),
    manifestIcon("/icons/icon-512.png", "512x512", "maskable", v),
  ];
  return {
    id: "/",
    name: "재고관리",
    short_name: "재고관리",
    description: "타고스포츠 재고관리 프로그램",
    start_url: "/products",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#1a3059",
    theme_color: "#1a3059",
    icons,
  };
}
