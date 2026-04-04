/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "godomall-storage.cdn-nhncommerce.com",
      },
    ],
  },
  async headers() {
    const noStoreHtml = [
      { key: "Cache-Control", value: "private, no-store, no-cache, must-revalidate, max-age=0" },
      { key: "Pragma", value: "no-cache" },
    ];
    return [
      {
        source: "/products",
        headers: noStoreHtml,
      },
      {
        source: "/status",
        headers: noStoreHtml,
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;