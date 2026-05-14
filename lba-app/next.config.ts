import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    allowedOrigins: ['100.113.181.70', 'mac-mini-de-etienne.tail53fecb.ts.net', 'http://100.113.181.70:3008', 'https://mac-mini-de-etienne.tail53fecb.ts.net']
  },
  // Pour Next.js 16 :
  allowedDevOrigins: ['100.113.181.70', 'mac-mini-de-etienne.tail53fecb.ts.net', 'http://100.113.181.70:3008', 'https://mac-mini-de-etienne.tail53fecb.ts.net']
};

export default nextConfig;
