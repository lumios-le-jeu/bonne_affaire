import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    allowedOrigins: ['100.113.181.70']
  },
  // Pour Next.js 16 :
  allowedDevOrigins: ['100.113.181.70']
};

export default nextConfig;
