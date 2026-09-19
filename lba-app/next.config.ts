import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Un package-lock.json traine dans C:\Users\nak1oeil : sans cette ligne,
  // Turbopack choisit le dossier utilisateur comme racine du projet et ne
  // retrouve plus ni le manifeste client React ni @swc/helpers.
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      allowedOrigins: ['100.113.181.70', 'mac-mini-de-etienne.tail53fecb.ts.net', 'http://100.113.181.70:3008', 'https://mac-mini-de-etienne.tail53fecb.ts.net']
    }
  },
  allowedDevOrigins: ['100.113.181.70', 'mac-mini-de-etienne.tail53fecb.ts.net', 'http://100.113.181.70:3008', 'https://mac-mini-de-etienne.tail53fecb.ts.net']
};

export default nextConfig;
