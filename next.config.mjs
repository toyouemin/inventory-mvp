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
};

export default nextConfig;