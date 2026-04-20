/** @type {import('next').NextConfig} */
const nextConfig = {
  /** 개발 중 이중 마운트(Strict Mode)로 카드·DOM이 겹쳐 보이는지 구분할 때 false로 둠 */
  reactStrictMode: false,
  /**
   * Serverless 번들에 거래명세표 템플릿(xlsx)을 반드시 포함.
   * (배포 환경에서 /var/task/public/templates/transaction.xlsx 누락 방지)
   */
  outputFileTracingIncludes: {
    "/api/documents/transaction-statement/xlsx": ["./public/templates/**/*.xlsx"],
  },
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