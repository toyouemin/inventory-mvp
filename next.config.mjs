/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: true
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "godomall-storage.cdn-nhncommerce.com"
      }
    ]
  }
};

export default nextConfig;